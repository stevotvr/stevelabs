# StoveLabs

This is a custom Twitch bot for my channel.

## Setup

  1. Run `npm install`.
  2. Rename `config/*.json.example` files to `config/*.json` and edit the contents.
  3. Run `node index.js`.

## Configuration

### config.json

Main configuration.

  * **debug**: (`boolean`) Whether to enable test features
  * **host**: (`string`) The hostname on which the server should listen
  * **port**: (`integer`) The port on which the server should listen
  * **secret**: (`string`) An arbitrary secret string
  * **twitch**:
    * **api**:
       * **client**: (`string`) Your Twitch API client ID
       * **secret**: (`string`) Your Twitch API client secret
    * **channel**:
       * **username**: (`string`) Your Twitch channel username
       * **password**: (`string`) Your Twitch channel OAuth2 password
    * **bot**:
       * **username**: (`string`) Your Twitch bot account username
       * **password**: (`string`) Your Twitch bot account OAuth2 password
  * **donordrive**:
       * **instance**: (`string`) Your DonorDrive campaign insurance (subdomain)
       * **participant**: (`integer`) Your DonorDrive campaign participant ID
  * **ssl**:
    * **enabled**: (`boolean`) Whether to enable SSL (HTTPS)
    * **keyfile**: (`string`) The absolute path to your SSL certificate's key file
    * **cert**: (`string`) The absolute path to your SSL certificate file
    * **cafile**: (`string`) The absolute path to your SSL certificate authority file

### alerts.json

Configuration of overlay alerts.

Place images, videos, and sounds in the `public/media` directory. Read the example message of each section for a hint of what it does. Each section has the following variables:

  * **message**: (`string`) The alert text (variables formatted as ${name})
  * **graphic**: (`string`) The name of the image or video file to display
  * **sound**: (`string`) The name of the sound file to play
  * **duration**: (`integer`) How long to display the alert in seconds

### commands.json

Configuration of custom chat commands.

Keys in the root object are the names of the commands. Each child object has the following variables:

  * **level**: (`integer`) Required permission to use the command (0 = anyone, 1 = subscriber, 2 = moderator, 3 = broadcaster)
  * **userTimeout**: (`integer`) Per-user timeout in seconds between uses of this command (0 to disable)
  * **globalTimeout**: (`integer`) Global timeout in seconds between uses of this command (0 to disable)
  * **aliases**: (`array`) A list of aliases for this command
  * **message**: (`string`) The command response (variables formatted as ${name})

### timers.json

Configuration of timers.

Timers display messages in chat at regular intervals, looping in the order listed.

  * **timeout**: (`integer`) Time between messages in seconds (0 to disable timers)
  * **chatLines**: (`integer`) Number of chat messages required between timers
  * **messages**: (`array`) List of messages to send to chat

### schedule.json

Configuration of your streaming schedule.

This is meant to be accessed by external scripts at `YOUR_BASE_URL/schedule.json`. Each section has the following variables:

  * **day**: (`integer`) The day of the week (0 = Sunday)
  * **hour**: (`integer`) The hour of the day (24-hour)
  * **minute**: (`integer`) The minute of the day
  * **length**: (`integer`) The length of the stream in minutes
  * **game**: (`string`) The name of the game to be streamed

## License

The source code is released under the terms of the [MIT License](https://github.com/stevotvr/twitchbot/blob/master/LICENSE.txt).
