/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

import Twitter from 'twitter-lite';

/**
 * Provides Twitter bot functionality.
 */
export default class TwitterBot {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Log in to the Twitter API.
   */
  login() {
    if (!this.app.settings.twitter_consumer_key || !this.app.settings.twitter_consumer_secret || !this.app.settings.twitter_access_token_key || !this.app.settings.twitter_access_token_secret)
    {
      this.client = undefined;
      return;
    }

    this.client = new Twitter({
      consumer_key: this.app.settings.twitter_consumer_key,
      consumer_secret: this.app.settings.twitter_consumer_secret,
      access_token_key: this.app.settings.twitter_access_token_key,
      access_token_secret: this.app.settings.twitter_access_token_secret
    });
  }

  /**
   * Set whether the Twitch channel is live.
   *
   * @param {boolean} live The channel is live
   */
  setLive(live) {
    if (!this.client) {
      return;
    }

    this.client.get('account/verify_credentials')
      .then((res) => {
        const add = '🔴【LIVE】 ';
        const name = res.name.replace(add, '');

        let description, savedDescription;
        if (!live && this.app.settings.twitter_bio) {
          description = this.app.settings.twitter_bio;
          savedDescription = null;
        } else if (live && this.app.settings.twitter_live_message) {
          description = this.app.settings.twitter_live_message.replace(/\${name}/g, this.app.config.users.host).replace(/\${game}/g, this.app.api.game);
          savedDescription = res.description;
        } else {
          return;
        }

        this.client.post('account/update_profile', {
          name: live ? add + name : name,
          description: description
        })
        .then(() => {
          console.log('updated Twitter name');

          this.app.settings.twitter_bio = savedDescription;
          this.app.saveSettings();
        })
        .catch((err) => {
          console.warn('could not update Twitter profile');
          console.log(err);
        });
      })
      .catch((err) => {
        console.warn('failed to get Twitter account');
        console.log(err);
      });
  }
}
