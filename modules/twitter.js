/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

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
      .then(res => {
        const add = '🔴【LIVE】 ';
        const name = res.name.replace(add, '');
        this.client.post('account/update_profile', {
          name: live ? add + name : name,
          description: this.getDescription(live, res.description)
        })
        .then(() => {
          console.log('updated Twitter name');
        })
        .catch(err => {
          console.warn('could not update Twitter profile');
          console.log(err);
        });
      })
      .catch(err => {
        console.warn('failed to get Twitter account');
        console.log(err);
      });
  }

  /**
   * Get the description text for the Twitter profile.
   *
   * @param {boolean} live Whether to get the live description
   * @param {string} current The current profile description
   */
  getDescription(live, current) {
    if (!live && this.app.settings.twitter_bio) {
      this.app.settings.twitter_bio = null;
      this.app.saveSettings();

      return this.app.settings.twitter_bio;
    } else if (live && this.app.settings.twitter_live_message) {
      if (!this.app.settings.twitter_bio) {
        this.app.settings.twitter_bio = current;
        this.app.saveSettings();
      }

      return this.app.settings.twitter_live_message.replace(/\$\{name\}/ig, this.app.config.users.host).replace(/\$\{game\}/ig, this.app.api.game);
    }

    return current;
  }
}
