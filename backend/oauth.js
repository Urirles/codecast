
const mysql = require('mysql');
const ClientOAuth2 = require('client-oauth2');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const request = require('request');
const randomstring = require('randomstring');

/*

Schema:

CREATE TABLE user_configs (`user_id` int(11) NOT NULL PRIMARY KEY, `value` TEXT NOT NULL);
ALTER TABLE user_configs ADD UNIQUE INDEX `ix_user_configs_user_id` (`user_id`);

*/

module.exports = function (app, config, callback) {

  const oauthClientCache = {};

  app.set('trust proxy', 1) // trust first proxy

  const store = new MySQLStore(config.database);
  app.use(session({...config.session, store: store}));

  app.get('/auth/:provider', function (req, res) {
    const {client} = getOauthConfig(req.params.provider);
    const state = req.session.oauth_state = randomstring.generate();
    res.redirect(client.code.getUri({state}));
  });
  app.get('/auth/:provider/callback', function (req, res) {
    const {provider} = req.params;
    const {client, config: authConfig} = getOauthConfig(provider);
    const state = req.session.oauth_state;
    client.code.getToken(req.originalUrl, {state})
      .then(function (token) {
        // Save token data in session.
        req.session.provider = provider;
        req.session.token = token.data;
        // Query identity provider with token.
        request(token.sign({method: 'GET', url: authConfig.identityProviderUri}), function (err, response, body) {
          if (err) return res.render('after_login', {error: err.toString()});
          req.session.identity = JSON.parse(body);
          const user = getUser(req.session.identity);
          res.render('after_login', {user});
        });
      })
      .catch(function (err) {
        return res.render('after_login', {error: err.toString()});
      });
  });
  app.get('/logout', function (req, res) {
    const {provider} = req.session;
    const logoutUri = provider && getOauthConfig(provider).config.logoutUri;
    req.session.destroy(function (err) {
      res.render('after_logout', {
        rebaseUrl: config.rebaseUrl,
        logoutUri
      });
    });
  });

  config.db = mysql.createConnection(config.database);

  function getOauthConfig (provider) {
    let authConfig = config.auth[provider];
    if (!authConfig) {
      throw new Error(`unknown auth provider ${provide}`);
    }
    let client = oauthClientCache[provider];
    if (!client) {
      client = oauthClientCache[provider] = new ClientOAuth2(authConfig.oauth2);
    }
    return {config: authConfig, client};
  }

  function getUser (identity) {
    if (!identity) return false;
    const {idUser, sLogin} = identity;
    return {id: idUser, login: sLogin};
  }

  config.initHook = function (req, init, callback) {
    let user;
    if ('guest' in req.query) {
      user = {guest: true};
    } else {
      user = getUser(req.session.identity)
    }
    callback(null, {...init, authProviders: Object.keys(config.auth), user});
  };

  config.getUserConfig = function (req, callback) {
    if (!identity) {
      // TODO: return guest user config
      return callback(null, {});
    }
    const q = `SELECT value FROM user_configs WHERE user_id = '${identity.idUser}' LIMIT 1`;
    config.db.connect(function (err) {
      if (err) return callback(err);
      config.db.query(q, function (error, results, fields) {
        if (error || results.length !== 1) return callback('database error');
        let userConfig;
        try {
          userConfig = JSON.parse(results[0].value);
        } catch (ex) {
          return callback('parse error');
        }
        callback(null, userConfig);
      });
    });
  };

  callback(null);

};