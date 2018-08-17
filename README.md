# Homebridge Intesis
This is a Homebridge plugin that allows you to create heater/cooler accessories in HomeKit for your Intesis devices.  This uses the Intesis REST API.  You will need to request access to the REST API by contacting Intesis.

This plugin will create a heater/cooler accessory in HomeKit per device that is returned by the Intesis REST API.

## Installation
You must have Homebridge already installed, then just install the plugin by running `npm install -g homebridge-intesis`

## Configuration
I have included an example config of the platform in `example.config.json`.

### Required Options
* `platform` - Must be "intesis".
* `clientID` - This is the client ID that Intesis will provide.
* `clientSecret` - This is the client secret that Intesis will provide
* `username` - This is the username you use to log into the web platform/app.
* `password` - This is the password you use to log into the web platform/app.

### Optional Options
* `apiBaseURL` - If the Intesis API URL changes you can set this.  This will default to "https://user.intesishome.com/".
* `grantType` - Best to leave this one alone.  It has to do with the authentication.  It defaults to "password".
* `configCacheSeconds` - This is the number of seconds the plugin will cache the config from Intesis.  This will prevent the plugin from hammering the REST API for the latest config.  Default value is 30.