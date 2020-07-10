/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const discord = require('discord.js');

/**
 * Provides Discord bot functionality.
 */
class DiscordBot {

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
   * @param {string} channelName The name of the channel
   * @param {string} title The stream title
   * @param {int} gameId The game ID
   */
  postLive(channelName, title, gameId) {
    if (!this.ready || !this.app.settings.discord_channel) {
      return;
    }

    new Promise(async (resolve, reject) => {
      let channel;
      try {
        channel = await this.bot.channels.fetch(this.app.settings.discord_channel);
      } catch (err) {
        console.warn('failed to get Discord channel');
        reject(err);

        return;
      }

      const url = `https://www.twitch.tv/${channelName}`;
      const options = {
        embed: {
          author: {
            name: channelName,
            url: url
          },
          title: title,
          url: url
        }
      };

      const user = await this.app.api.getUser(channelName);
      if (user) {
        this.app.settings.live_stream_image = user.profile_image_url;
        options.embed.thumbnail = {
          url: this.app.settings.live_stream_image
        };
      }

      let game = await this.app.api.getGame(gameId);
      if (game) {
        options.embed.description = `Playing ${game.name}`;
      }

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
            await message.edit(this.getMessage(this.app.settings.discord_live_message, channelName), options);
            resolve();

            return;
          } catch (err) {
            console.warn('failed to edit Discord message');
            console.log(err);
            console.log('posting new message...');
          }
        }
      }

      channel.send(this.getMessage(this.app.settings.discord_live_message, channelName), options)
      .then(message => {
        this.app.settings.live_stream_time = Date.now();
        this.app.settings.live_channel_name = channelName;
        this.app.settings.live_stream_discord_id = message.id;
        this.app.saveSettings();

        resolve();
      })
      .catch(err => {
        console.warn('failed to post to Discord');
        reject(err);
      });
    })
    .catch(err => console.log(err));
  }

  /**
   * Post the stream end message to the Discord channel.
   */
  postEnd() {
    if (!this.ready || !this.app.settings.discord_channel || !this.app.settings.live_stream_discord_id) {
      return;
    }

    new Promise(async (resolve, reject) => {
      let channel;
      try {
        channel = await this.bot.channels.fetch(this.app.settings.discord_channel);
      } catch (err) {
        console.warn('failed to get Discord channel');
        reject(err);

        return;
      }

      let message;
      try {
        message = await channel.messages.fetch(this.app.settings.live_stream_discord_id);
      } catch (err) {
        console.warn('failed to get Discord message');
        reject(err);

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

      message.edit(this.getMessage(this.app.settings.discord_ended_message, this.app.settings.live_channel_name), options)
      .then(() => resolve())
      .catch(err => {
        console.warn('failed to edit Discord message');
        reject(err);
      });
    })
    .then(() => {
      this.app.settings.live_stream_discord_id = undefined;
      this.app.saveSettings();
    })
    .catch(err => console.log(err));
  }

  /**
   * Get a formatted message.
   *
   * @param {string} format The format string
   * @param {string} name The channel name
   */
  getMessage(format, name) {
    if (format) {
      return format.replace(/\$\{name\}/ig, name);
    }
  }
}

module.exports.DiscordBot = DiscordBot;
