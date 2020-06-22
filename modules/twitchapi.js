/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

/**
 * Handles Twitch API operations.
 */
class TwitchApi {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    this.whTimeouts = {
      stream: 0,
      follows: 0
    };
  }

  /**
   * Query the Twitch API.
   *
   * @param {string} url The URL to query
   * @param {string} method GET or POST
   * @param {object} body Object to send as the JSON body
   * @param {string} access_token The optional access token to use
   * @param {string} refresh_token The optional refresh token to use
   */
  request(url, method, body, access_token, refresh_token) {
    const app = this.app;
    const settings = app.settings;

    access_token = access_token ? access_token : settings.oauth_access_token;
    refresh_token = refresh_token ? refresh_token : settings.oauth_refresh_token;

    return new Promise((resolve, reject) => {
      if (!access_token) {
        reject('api request failed due to missing access token');
        return;
      }

      const options =  {
        method: method,
        headers: {
          'Client-ID': app.config.oauth.client,
          'Authorization': `Bearer ${access_token}`
        }
      };

      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      fetch(url, options)
        .then(res => {
          if (res.status === 401) {
            if (!refresh_token) {
              reject('api request failed due to invalid or expired access token');
              return;
            }

            fetch('https://id.twitch.tv/oauth2/token', {
              method: 'POST',
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: settings.oauth_refresh_token,
                client_id: app.config.oauth.client,
                client_secret: app.config.oauth.secret
              })
            })
            .then(res => res.json())
            .then(json => {
              if (json.access_token) {
                settings.oauth_access_token = json.access_token;
                settings.oauth_refresh_token = json.refresh_token;

                options.headers['Authorization'] = `Bearer ${settings.oauth_access_token}`;

                fetch(url, options)
                .then(res => resolve(res));
              } else {
                settings.oauth_access_token = '';
                settings.oauth_refresh_token = '';

                reject('failed to refresh token');
              }
            })
            .finally(() => {
              app.saveSettings();
            });
          } else {
            resolve(res);
          }
        })
        .catch(reject);
    });
  }

  /**
   * Create or destroy all webhooks.
   *
   * @param {bool} enable Whether to enable the webhooks
   */
  setWebhooks(enable = true) {
    this.setStreamWebhook(enable);
    this.setFollowsWebhook(enable);
  }

  /**
   * Create or destroy the stream webhook.
   * This webhook notifies us of changes to the stream.
   *
   * @param {bool} enable Whether to enable the webhook
   */
  setStreamWebhook(enable = true) {
    this.setWebhook(`https://api.twitch.tv/helix/streams?user_id=${this.userid}`, 'stream', enable);

    if (!enable) {
      clearTimeout(this.whTimeouts.stream);
    }
  }

  /**
   * Create or destroy the follows webhook.
   * This webhook notifies us of new followers.
   *
   * @param {bool} enable Whether to enable the webhook
   */
  setFollowsWebhook(enable = true) {
    this.setWebhook(`https://api.twitch.tv/helix/users/follows?first=1&to_id=${this.userid}`, 'follows', enable);

    if (!enable) {
      clearTimeout(this.whTimeouts.follow);
    }
  }

  /**
   * Subscribe or unsubscribe to a Twitch webhook.
   *
   * @param {string} topic The topic to which to subscribe or unsubscribe
   * @param {string} cb The name of the callback
   * @param {bool} enable Whether to enable the webhook
   */
  setWebhook(topic, cb, enable) {
    this.request('https://api.twitch.tv/helix/webhooks/hub', 'POST', {
      'hub.callback': `${this.app.config.url}/wh/${cb}`,
      'hub.mode': enable ? 'subscribe' : 'unsubscribe',
      'hub.topic': topic,
      'hub.lease_seconds': 86400,
      'hub.secret': this.app.settings.secret
    })
    .catch(err => {
      console.warn(`failed to ${enable ? 'create' : 'destroy'} stream webhook subscription`);
      console.log(err);
    });
  }

  /**
   * Verify authentication tokens and load user data.
   *
   * @param {string} access_token The access token to check
   * @param {string} refresh_token The refresh token
   */
  checkToken(access_token, refresh_token) {
    const api = this;
    const app = this.app;
    const settings = app.settings;

    return new Promise((resolve, reject) => {
      if (!access_token) {
        resolve(false);
        return;
      }

      api.request('https://api.twitch.tv/helix/users', 'GET', false, access_token, refresh_token)
      .then(res => res.json())
      .then(user => {
        if (settings.twitch_channel_username === undefined || (user.data && user.data[0] && user.data[0].login === settings.twitch_channel_username)) {
          api.userid = user.data[0].id;
          settings.twitch_channel_username = user.data[0].login;

          if (access_token !== settings.oauth_access_token) {
            settings.oauth_access_token = access_token;
            settings.oauth_refresh_token = refresh_token;

            app.saveSettings();
          }

          console.log(`authenticated with Twitch as user ${ user.data[0].login}`);

          resolve(true);
        } else {
          if (access_token === settings.oauth_access_token) {
            settings.oauth_access_token = '';
            settings.oauth_refresh_token = '';
            app.userid = 0;

            app.saveSettings();
          }

          resolve(false);
        }
      })
      .catch(err => {
        console.warn('api request for user data failed');
        console.log(err);
        resolve(false);
      });
    });
  }

  /**
   * Update the current status of the stream.
   */
  checkStream() {
    if (!this.userid) {
      return;
    }

    const app = this.app;

    this.request(`https://api.twitch.tv/helix/streams?user_id=${this.userid}`, 'GET')
    .then(res => res.json())
    .then(chan => {
      app.islive = chan.data && chan.data.length > 0;
      console.log(`channel is ${app.islive ? 'LIVE!' : 'offline'}`);
    })
    .catch(err => {
      console.warn('api request for channel data failed');
      console.log(err);
    });
  }

  /**
   * Get user data from Twitch.
   *
   * @param {string} login The username
   */
  getUser(login) {
    return new Promise((resolve, reject) => {
      this.request(`https://api.twitch.tv/helix/users?login=${login}`, 'GET')
        .then(res => res.json())
        .then(user => {
          if (user.data && user.data[0]) {
            resolve(user.data[0]);
          } else {
            reject();
          }
        })
        .catch(err => {
          console.warn('api request for user data failed');
          console.log(err);
          reject();
        });
    });
  }
}

module.exports.TwitchApi = TwitchApi;
