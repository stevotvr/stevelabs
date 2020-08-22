/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import ApiClient, { StaticAuthProvider, RefreshableAuthProvider } from 'twitch';
import WebHookListener, { SimpleAdapter } from 'twitch-webhooks';

/**
 * Handles Twitch API operations.
 */
export default class TwitchApi {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
  }

  async login(access_token, refresh_token) {
    if (!access_token || !refresh_token) {
      return false;
    }

    const app = this.app;
    const sap = new StaticAuthProvider(app.config.oauth.client, access_token);

    const client = new ApiClient({
      authProvider: new RefreshableAuthProvider(sap, {
        clientSecret: app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          access_token = token.accessToken;
          refresh_token = token.refreshToken;
        }
      })
    });

    const token = await client.getTokenInfo();
    if (token.userName === app.config.users.host) {
      app.settings.oauth_access_token = access_token;
      app.settings.oauth_refresh_token = refresh_token;
      app.saveSettings();

      this.auth = new RefreshableAuthProvider(sap, {
        clientSecret: app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          app.settings.oauth_access_token = token.accessToken;
          app.settings.oauth_refresh_token = token.refreshToken;
          app.saveSettings();
        }
      });
      this.client = new ApiClient({
        authProvider: this.auth
      });
      this.userId = token.userId;

      this.setupWebhooks();
      this.checkStream();

      console.log(`authenticated with Twitch as user ${token.userName}`);
    } else if (token.userName === app.config.users.bot) {
      app.settings.bot_access_token = access_token;
      app.settings.bot_refresh_token = refresh_token;
      app.saveSettings();

      this.botAuth = new RefreshableAuthProvider(sap, {
        clientSecret: app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          app.settings.bot_access_token = token.accessToken;
          app.settings.bot_refresh_token = token.refreshToken;
          app.saveSettings();
        }
      });
    }

    app.chatbot.setupTwitchClients();
  }

  /**
   * Create all webhooks.
   */
  async setupWebhooks() {
    if (this.whListener) {
      await this.whListener.unlisten();
    }

    this.whListener = new WebHookListener(this.client, new SimpleAdapter({
      hostName: this.app.config.host,
      listenerPort: this.app.config.port + 10
    }));
    await this.whListener.listen();

    await this.whListener.subscribeToStreamChanges(this.userId, this.streamCallback);
    await this.whListener.subscribeToFollowsToUser(this.userId, this.followCallback);
  }

  async streamCallback(stream) {
    if (stream) {
      if (!this.app.islive) {
        this.app.chatbot.sessionUsers.clear();
        this.app.twitter.setLive(true);
      }

      this.app.islive = true;
      this.app.discord.postLive(stream.title, await stream.getGame());
    } else {
      this.app.islive = false;
      this.app.discord.postEnd();
      this.app.twitter.setLive(false);
    }

    console.log(`channel is ${this.app.islive ? 'LIVE!' : 'offline'}`);
  }

  async followCallback(follow) {
    http.sendAlert('follower', {
      user: follow.userDisplayName
    });
  }

  /**
   * Update the current status of the stream.
   */
  async checkStream() {
    const stream = await this.client.helix.streams.getStreamByUserId(this.userId);
    this.app.islive = stream !== null;
    console.log(`channel is ${this.app.islive ? 'LIVE!' : 'offline'}`);
  }
}
