# StoveLabs

This is a custom Twitch bot for my channel.

## Setup

  1. Run `npm install`.
  2. Rename `config.json.example` files to `config.json` and edit the contents.
  3. Run `node index.js`.

## Configuration

### config.json

Main configuration.

  * **debug**: (`boolean`) Whether to enable test features
  * **host**: (`string`) The hostname on which the server should listen
  * **port**: (`integer`) The port on which the server should listen
  * **ssl**:
    * **enabled**: (`boolean`) Whether to enable SSL (HTTPS)
    * **keyfile**: (`string`) The absolute path to your SSL certificate's key file
    * **cert**: (`string`) The absolute path to your SSL certificate file
    * **cafile**: (`string`) The absolute path to your SSL certificate authority file
  * **oauth**:
    * **client**: (`string`) Your Twitch API client ID
    * **secret**: (`string`) Your Twitch API client secret
    
## License

The source code is released under the terms of the [MIT License](https://github.com/stevotvr/twitchbot/blob/master/LICENSE.txt).
