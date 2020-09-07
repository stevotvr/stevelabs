/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import discord from 'discord.js';

/**
 * Provides Discord bot functionality.
 */
export default class DiscordBot {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    this.bot = new discord.Client();

    this.bot.once('ready', () => {
      this.ready = true;
      console.log('connected to Discord');
    });
  }

  /**
   * Log in to the Discord bot.
   *
   * @param {string} token The Discord bot token
   */
  login(token) {
    this.bot.login(token);
  }

  /**
   * Post the live notification to the Discord channel.
   *
   * @param {HelixStream} stream The stream data
   */
  async postLive(stream) {
    if (!this.ready || !this.app.settings.discord_channel) {
      return;
    }

    let channel;
    try {
      channel = await this.bot.channels.fetch(this.app.settings.discord_channel);
    } catch (err) {
      console.warn('failed to get Discord channel');
      console.log(err);
      return;
    }

    let user;
    try {
      user = await stream.getUser();
      this.app.settings.live_stream_image = user.profilePictureUrl;
    } catch (err) {
      console.warn('failed to query Twitch for stream info');
      console.log(err);
      return;
    }

    const url = `https://www.twitch.tv/${this.app.settings.twitch_channel_username}`;
    const options = {
      embed: {
        author: {
          name: user.displayName,
          url: url
        },
        title: stream.title,
        url: url,
        thumbnail: {
          url: this.app.settings.live_stream_image
        }
      }
    };

    options.embed.description = `Playing ${this.app.api.game}`;

    if (this.app.settings.live_stream_discord_id) {
      let message;
      try {
        message = await channel.messages.fetch(this.app.settings.live_stream_discord_id);
      } catch (err) {
        console.warn('failed to get Discord message');
        console.log(err);
        console.log('posting new message...');
      }

      if (message) {
        try {
          await message.edit(this.getMessage(this.app.settings.discord_live_message, user.displayName), options);
          resolve();

          return;
        } catch (err) {
          console.warn('failed to edit Discord message');
          console.log(err);
          console.log('posting new message...');
        }
      }
    }

    try {
      const discordMessage = await channel.send(this.getMessage(this.app.settings.discord_live_message, user.displayName), options);
      this.app.settings.live_stream_time = Date.now();
      this.app.settings.live_channel_name = user.displayName;
      this.app.settings.live_stream_discord_id = discordMessage.id;
      this.app.saveSettings();
    } catch (err) {
      console.warn('failed to post to Discord');
      console.log(err);
    }
  }

  /**
   * Post the stream end message to the Discord channel.
   */
  async postEnd() {
    if (!this.ready || !this.app.settings.discord_channel || !this.app.settings.live_stream_discord_id) {
      return;
    }

    let channel;
    try {
      channel = await this.bot.channels.fetch(this.app.settings.discord_channel);
    } catch (err) {
      console.warn('failed to get Discord channel');
      console.log(err);

      return;
    }

    let message;
    try {
      message = await channel.messages.fetch(this.app.settings.live_stream_discord_id);
    } catch (err) {
      console.warn('failed to get Discord message');
      console.log(err);

      return;
    }

    const url = `https://www.twitch.tv/${this.app.settings.live_channel_name}`;
    const duration = Date.now() - this.app.settings.live_stream_time;
    const options = {
      embed: {
        author: {
          name: this.app.settings.live_channel_name,
          url: url
        },
        description: `**Duration** ${Math.floor(duration / 3600000)} hours, ${Math.floor(duration / 60000 % 60)} minutes, ${Math.floor(duration / 1000 % 60)} seconds`
      }
    };

    if (this.app.settings.live_stream_image) {
      options.embed.thumbnail = {
        url: this.app.settings.live_stream_image
      };
    }

    try {
      await message.edit(this.getMessage(this.app.settings.discord_ended_message, this.app.settings.live_channel_name), options);
    } catch (err) {
      console.warn('failed to edit Discord message');
      console.log(err);
    }

    this.app.settings.live_stream_discord_id = undefined;
    this.app.saveSettings();
  }

  /**
   * Get a formatted message.
   *
   * @param {string} format The format string
   * @param {string} name The channel name
   */
  getMessage(format, name) {
    if (typeof format === 'string') {
      return format.replace(/\${name}/g, name).replace(/\${game}/g, this.app.api.game);
    }

    return '';
  }
}
