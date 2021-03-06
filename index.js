'use strict';

var Hapi = require('hapi');
var nconf = require('nconf');
var SocketIO = require('socket.io');
var crypto = require('crypto');

var services = require('./lib/services');

nconf.argv().env().file({ file: 'local.json' });

var users = 0;

var options = {
  views: {
    engines: {
      jade: require('jade')
    },
    isCached: process.env.node === 'production',
    path: __dirname + '/views',
    compileOptions: {
      pretty: true
    }
  }
};

var server = Hapi.createServer(nconf.get('domain'), nconf.get('port'), options);

var routes = [
  {
    method: 'GET',
    path: '/',
    config: {
      handler: home
    }
  }
];

server.route(routes);

// Animated_GIF worker JS file for converting video elements to GIFs
server.route({
  method: 'GET',
  path: '/gif-worker.js',
  config: {
    handler: {
      file: require.resolve('animated_gif/dist/Animated_GIF.worker.min.js')
    }
  }
});

server.route({
  path: '/{path*}',
  method: "GET",
  config: {
    handler: {
      directory: {
        path: './dist',
        listing: false,
        index: false
      }
    }
  }
});

server.start(function () {
  var io = SocketIO.listen(server.listener);

  var getUserId = function (fingerprint, ip) {
    return crypto.createHash('md5').update(fingerprint + ip).digest('hex');
  };

  var disconnectHandler = function() {
    users--;
    if (users < 0) {
      users = 0;
    }
    io.emit('active', users);
  }

  io.on('connection', function (socket) {
    socket.on('disconnect', disconnectHandler);

    users++;
    io.emit('active', users);

    socket.on('join', function (format) {
      socket.join(format);
      services.recent(socket, format);
    })

    var ip = socket.handshake.address;
    if (socket.handshake.headers['x-forwarded-for']) {
      ip = socket.handshake.headers['x-forwarded-for'].split(/ *, */)[0];
    }

    socket.on('message', function (data, cb) {
      if (data.length > 1 * 1024 * 1024 /* 1MB */) {
        console.log('Oversized message received: ' + (data.length / (1024 * 1024)) + 'MB');
        return cb(new Error('Message too large'));
      }

      data = JSON.parse(data);
      if (!data.fingerprint || data.fingerprint.length > 10) {
        return cb(new Error('Invalid fingerprint'));
      }

      var userId = getUserId(data.fingerprint, ip);
      var payload = {
        message: data.message,
        media: data.media,
        fingerprint: userId
      };

      services.addMessage(payload, function (err, chat) {
        if (err) {
          console.log('error ', err);
          return cb(new Error('Error adding message'));
        }

        cb(null, { userId: userId });
        var videoData = chat.media;
        var formats = ['webm', 'mp4'];

        formats.forEach(function (format) {
          chat.media = videoData[format];
          io.sockets.in(format).emit('message', chat);
        });
      });
    });
  });
});

function home(request, reply) {
  reply.view('index', {
    analytics: nconf.get('analytics')
  });
}
