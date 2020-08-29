/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import { BasicPubSubClient, SingleUserPubSubClient } from 'twitch-pubsub-client';
import TwitchClient from 'twitch';
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

    const client = TwitchClient.withCredentials(this.app.config.oauth.client, access_token, undefined, {
      clientSecret: this.app.config.oauth.secret,
      refreshToken: refresh_token,
      onRefresh: (token) => {
        access_token = token.accessToken;
        refresh_token = token.refreshToken;
      }
    });

    const token = await client.getTokenInfo();
    if (token.userName === this.app.config.users.host) {
      this.app.settings.oauth_access_token = access_token;
      this.app.settings.oauth_refresh_token = refresh_token;
      this.app.saveSettings();

      this.client = TwitchClient.withCredentials(this.app.config.oauth.client, access_token, undefined, {
        clientSecret: this.app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          this.app.settings.oauth_access_token = token.accessToken;
          this.app.settings.oauth_refresh_token = token.refreshToken;
          this.app.saveSettings();
        }
      });
      this.userId = token.userId;

      this.app.chatbot.setupTwitchClients();
      this.setupWebhooks();
      this.setupPubSub();
      this.checkStream();

      console.log(`authenticated with Twitch as user ${token.userName}`);

      return true;
    } else if (token.userName === this.app.config.users.bot) {
      this.app.settings.bot_access_token = access_token;
      this.app.settings.bot_refresh_token = refresh_token;
      this.app.saveSettings();

      this.botClient = TwitchClient.withCredentials(this.app.config.oauth.client, access_token, undefined, {
        clientSecret: this.app.config.oauth.secret,
        refreshToken: refresh_token,
        onRefresh: (token) => {
          this.app.settings.bot_access_token = token.accessToken;
          this.app.settings.bot_refresh_token = token.refreshToken;
          this.app.saveSettings();
        }
      });

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
   * Set up the PubSub client.
   */
  async setupPubSub() {
    if (this.psClient) {
      await this.psClient.disconnect();
    }

    this.psClient = new BasicPubSubClient();
    this.psClient.onConnect(() => {
      console.log('connected to Twitch PubSub');
    });
    this.psClient.onDisconnect((manually, reason) => {
      if (!manually) {
        console.warn('disconnected from Twitch PubSub');
        console.log(reason);
      }
    });
    this.psClient.connect();

    const userClient = new SingleUserPubSubClient({
      pubSubClient: this.psClient,
      twitchClient: this.client
    });
    userClient.onRedemption((message) => this.redemptionCallback(message));
  }

  /**
   * Handle a redemption message received by the PubSub client.
   *
   * @param {PubSubRedemptionMessage} message The redemption data
   */
  async redemptionCallback(message) {
    console.log(`${message.userName} redeemed channel point reward ${message.rewardName}`);
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
