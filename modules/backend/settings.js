/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

/**
 * Handler for the settings backend.
 */
export default class SettingsBackend {
  get(resolve) {
    resolve(this.app.settings);
  }

  post(resolve, req) {
    if (req.body.discord_bot_token !== this.app.settings.discord_bot_token) {
      this.app.settings.discord_bot_token = req.body.discord_bot_token;

      this.app.discord.login(this.app.settings.discord_bot_token);
    }

    this.app.settings.discord_channel = req.body.discord_channel;
    this.app.settings.discord_live_message = req.body.discord_live_message;
    this.app.settings.discord_ended_message = req.body.discord_ended_message;

    this.app.settings.twitter_consumer_key = req.body.twitter_consumer_key;
    this.app.settings.twitter_consumer_secret = req.body.twitter_consumer_secret;
    this.app.settings.twitter_access_token_key = req.body.twitter_access_token_key;
    this.app.settings.twitter_access_token_secret = req.body.twitter_access_token_secret;
    this.app.settings.twitter_live_message = req.body.twitter_live_message;
    this.app.twitter.login();

    this.app.settings.tiltify_access_token = req.body.tiltify_access_token;
    this.app.settings.tiltify_campaign = req.body.tiltify_campaign;
    this.app.settings.donordrive_instance = req.body.donordrive_instance;
    this.app.settings.donordrive_participant = req.body.donordrive_participant;
    this.app.charity.init();

    this.app.settings.countdown_audio = req.body.countdown_audio;
    this.app.settings.countdown_audio_volume = Math.max(0, Math.min(100, req.body.countdown_audio_volume));

    this.app.settings.tts_api_key = req.body.tts_api_key;
    this.app.settings.tts_voice = req.body.tts_voice;
    this.app.settings.tts_volume = Math.max(0, Math.min(100, req.body.tts_volume));

    this.app.saveSettings();

    resolve();
  }
}
