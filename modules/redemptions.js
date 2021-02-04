/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

import { BasicPubSubClient, SingleUserPubSubClient } from 'twitch-pubsub-client';

/**
 * Handles channel point redemptions.
 */
export default class Redemptions {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
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
      twitchClient: this.app.api.client
    });
    userClient.onRedemption((message) => this.redemptionCallback(message));
  }

  /**
   * Handle a redemption message received by the PubSub client.
   *
   * @param {PubSubRedemptionMessage} message The redemption data
   */
  async redemptionCallback(message) {
    this.app.db.get('SELECT command FROM redemptions WHERE name = ?', message.rewardName, (err, row) => {
      if (err) {
        console.warn('error checking redemptions');
        console.log(err);

        return;
      }

      if (row) {
        console.log(`processing redemption ${message.rewardName} for user ${message.userName}`);
        this.app.commands.parseCommand(row.command, message.message ? message.message.split(/\s+/) : [], {
          userId: message.userId,
          userName: message.userName,
          displayName: message.userDisplayName
        });
      }
    });
  }
}
