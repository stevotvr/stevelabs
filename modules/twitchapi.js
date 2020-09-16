/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import { ApiClient } from 'twitch';
import { RefreshableAuthProvider, StaticAuthProvider } from 'twitch-auth';
import { WebHookListener, SimpleAdapter } from 'twitch-webhooks';

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

    const sap = new StaticAuthProvider(this.app.config.oauth.client, access_token);

    let rap = new RefreshableAuthProvider(sap, {
      clientSecret: this.app.config.oauth.secret,
      refreshToken: refresh_token,
      onRefresh: (token) => {
        access_token = token.accessToken;
        refresh_token = token.refreshToken;
      }
    });
    const client = new ApiClient({ authProvider: rap });

    const token = await client.getTokenInfo();
    if (token.userName === this.app.config.users.host) {
      this.app.settings.oauth_access_token = access_token;
      this.app.settings.oauth_refresh_token = refresh_token;
      this.app.saveSettings();

      rap = new RefreshableAuthProvider(sap, {
        clientSecret: this.app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          this.app.settings.oauth_access_token = token.accessToken;
          this.app.settings.oauth_refresh_token = token.refreshToken;
          this.app.saveSettings();
        }
      });
      this.client = new ApiClient({ authProvider: rap });
      this.userId = token.userId;

      this.app.chatbot.setupTwitchClients();
      this.app.redemptions.setupPubSub();
      this.setupWebhooks();
      this.checkStream();

      console.log(`authenticated with Twitch as user ${token.userName}`);

      return true;
    } else if (token.userName === this.app.config.users.bot) {
      this.app.settings.bot_access_token = access_token;
      this.app.settings.bot_refresh_token = refresh_token;
      this.app.saveSettings();

      rap = new RefreshableAuthProvider(sap, {
        clientSecret: this.app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          this.app.settings.bot_access_token = token.accessToken;
          this.app.settings.bot_refresh_token = token.refreshToken;
          this.app.saveSettings();
        }
      });
      this.botClient = new ApiClient({ authProvider: rap });

      this.app.chatbot.setupTwitchClients();

      return true;
    }

    return false;
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

    await this.whListener.subscribeToStreamChanges(this.userId, (stream) => this.streamCallback(stream));
    await this.whListener.subscribeToFollowsToUser(this.userId, (follow) => this.followCallback(follow));
  }

  /**
   * Handle the stream change webhook message.
   *
   * @param {HelixStream} stream The stream data
   */
  async streamCallback(stream) {
    if (stream) {
      const game = await stream.getGame();
      this.game = game.name;

      if (!this.app.islive) {
        this.app.chatbot.sessionUsers.clear();
        this.app.twitter.setLive(true);
      }

      this.app.islive = true;
      this.app.discord.postLive(stream);
    } else {
      this.app.islive = false;
      this.app.discord.postEnd();
      this.app.twitter.setLive(false);
    }

    console.log(`channel is ${this.app.islive ? 'LIVE!' : 'offline'}`);
  }

  /**
   * Handle the follow to user webhook message.
   *
   * @param {HelixFollow} follow The follow data
   */
  async followCallback(follow) {
    this.app.http.sendAlert('follower', {
      user: follow.userDisplayName
    });
  }

  /**
   * Update the current status of the stream.
   */
  async checkStream() {
    const stream = await this.client.helix.streams.getStreamByUserId(this.userId);
    this.app.islive = stream !== null;

    if (stream) {
      const game = await stream.getGame();
      this.game = game.name;

      this.app.discord.postLive(stream);
      this.app.twitter.setLive(true);
    } else {
      this.app.discord.postEnd();
      this.app.twitter.setLive(false);
    }

    console.log(`channel is ${this.app.islive ? 'LIVE!' : 'offline'}`);
  }
}
