'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const spawn = require('child_process').spawn;
const rootDir = path.resolve(path.dirname(__dirname));
const app = express();
const AnsiToHtml = require('ansi-to-html');

const upload = require('./upload');
const directives = require('./directives');

app.set('view engine', 'pug');
app.set('views', path.join(rootDir, 'backend', 'views'));

const isDevelopment = process.env.NODE_ENV !== 'production';
console.log(`running in ${isDevelopment ? 'development' : 'production'} mode`);

if (isDevelopment) {
  // Development route: /build is managed by webpack
  const webpack = require('webpack');
  const webpackDevMiddleware = require('webpack-dev-middleware');
  const webpackConfig = require('../webpack.config.js');
  const compiler = webpack(webpackConfig);
  app.use('/build', webpackDevMiddleware(compiler, {
    stats: {
      colors: true,
      chunks: false
    }
  }));
} else {
  // Production route: /build serves static files in build/
  app.use('/build', express.static(path.join(rootDir, 'build')));
}

/* Serve static assets. */
app.use('/assets', express.static(path.join(rootDir, 'assets')));
function rebaseUrl (url) {
  return `${process.env.BASE_URL}/${url}`;
}

app.use(bodyParser.json());

app.get('/recorder', function (req, res) {
  getConfigByToken(req.query.token, function (err, config) {
    if (err) return res.redirect(`${process.env.BASE_URL}/`);
    res.render('index', {development: isDevelopment, rebaseUrl});
  })
});

app.get('/player', function (req, res) {
  res.render('player', {development: isDevelopment, rebaseUrl});
});

app.get('/', function (req, res) {
  res.render('sandbox', {development: isDevelopment, rebaseUrl});
});

app.post('/upload', function (req, res) {
  getConfigByToken(req.params.token, function (err, config) {
    if (err) return json({error: err});
    const id = Date.now().toString();
    const uploadPath = config.uploadPath || 'uploads';
    const base = `${uploadPath}/${id}`;
    const s3client = makeS3Client(config);
    upload.getJsonUploadForm(s3client, config.s3Bucket, base, function (err, events) {
      // if (err) ...
      upload.getMp3UploadForm(base, function (err, audio) {
        // if (err) ...
        res.json({id: id, events: events, audio: audio});
      });
    });
  });
});

app.post('/translate', function (req, res) {
  const env = {};
  Object.assign(env, process.env);
  env.SYSROOT = path.join(rootDir, 'sysroot');
  const source = req.body.source;
  const cp = spawn('./c-to-json', {env: env});
  const chunks = [];
  const errorChunks = [];
  let errorSent = false;
  cp.stdout.on('data', function (chunk) {
    chunks.push(chunk);
  });
  cp.stderr.on('data', function (chunk) {
    errorChunks.push(chunk);
  });
  cp.stdin.on('error', function (err) {
    errorSent = true;
    res.json({error: err.toString()});
  });
  cp.stdin.write(source, function (err) {
    if (err) return;
    cp.stdin.end();
  });
  cp.on('close', function (code) {
    if (errorSent)
      return;
    if (code === 0) {
      if (chunks.length === 0) {
        const convert = new AnsiToHtml();
        res.json({diagnostics: convert.toHtml(errorChunks.join(''))});
      } else {
        try {
          const ast = JSON.parse(chunks.join(''));
          const convert = new AnsiToHtml();
          directives.enrichSyntaxTree(source, ast);
          res.json({ast: ast, diagnostics: convert.toHtml(errorChunks.join(''))});
        } catch (err) {
          res.json({error: err.toString()});
        }
      }
    } else {
      res.json({error: errorChunks.join('')});
    }
  });
  cp.on('error', function (err) {
    errorSent = true;
    res.json({error: err.toString()});
  });

});

const server = http.createServer(app);
server.listen(process.env.PORT);

function getConfigByToken (token, callback) {
  if (token === undefined) {
    token = 'default';
  }
  fs.readFile('config.json', 'utf8', function (err, data) {
    if (err) return res.json({error: err.toString()});
    const configFile = JSON.parse(data);
    const {configs, tokens} = configFile;
    if (!(token in tokens)) {
      return callback('bad token');
    }
    const config = {};
    tokens[token].forEach(function (item) {
      if (typeof item === 'object') {
        Object.assign(config, item);
      } else if (typeof item === 'string') {
        Object.assign(config, configs[item]);
      }
    });
    callback(null, config);
  });
}
