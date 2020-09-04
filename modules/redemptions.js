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
    this.app.db.db.all('SELECT id, name, random FROM giveaway_groups WHERE redemption = ?', message.rewardName, (err, rows) => {
      if (err) {
        console.warn('error loading giveaways');
        console.log(err);

        return;
      }

      rows.forEach(giveaway => {
        const sql = `SELECT id, name, key FROM giveaway WHERE groupId = ? AND recipient IS NULL${giveaway.random ? ' ORDER BY RANDOM()' : ''} LIMIT 1`;
        this.app.db.db.get(sql, giveaway.id, (err, row) => {
          if (err) {
            console.warn(`error loading item from giveaway #${giveaway.id}`);
            console.log(err);

            return;
          }

          if (!row) {
            console.log(`attempted to give item from empty giveaway ${giveaway.name} to ${message.userName}`);
            this.app.chatbot.say(`${message.userDisplayName} oops, it looks like we are all out of items for ${message.rewardName}. :(`);

            return;
          }

          this.app.chatbot.say(`${message.userDisplayName} check your whispers!`);
          this.app.chatbot.whisper(message.userName, `Here is your key for ${row.name}: ${row.key}`);
          this.app.db.db.run('UPDATE giveaway SET recipient = ? WHERE id = ?', message.userName, row.id);

          console.log(`key ${row.key} for ${row.name} given to ${message.userName}`);
        });
      });
    });
  }
}
