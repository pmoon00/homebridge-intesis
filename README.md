# Homebridge Intesis
## ------NOTICE PLEASE READ------
Thank you for your interest into the Homebridge Intesis plugin.  Intesis has informed me that they do not currently have a formal process in place to accept any more API key requests.  They are doing their best and are in the process of coming up with a formal process.

Intesis have asked that I temporarily bring down the NPM package and Github repo, but it is considered bad practise.  Can you please register your interest to get an API key via this Google Form (https://goo.gl/forms/90Kz1bjU9i0X53Ak1) and I will pass it on to Intesis.  **Please fill out the form instead of contacting Intesis directly.**

**REGISTER FOR API KEY BY USING LINK BELOW**
https://goo.gl/forms/90Kz1bjU9i0X53Ak1
**Please not contact Intesis directly.**

## Overview
This is a Homebridge plugin that allows you to create heater/cooler accessories in HomeKit for your Intesis devices.  This uses the Intesis REST API.  ~~You will need to request access to the REST API by contacting Intesis.~~ **PLEASE SEE THE NOTICE ABOVE ABOUT API KEYS.**

This plugin will create a heater/cooler accessory in HomeKit per device that is returned by the Intesis REST API.

## Installation
You must have Homebridge already installed, then just install the plugin by running `npm install -g homebridge-intesis`

## Configuration
I have included an example config of the platform in `example.config.json`.

### Required Options
* `platform` - Must be "intesis".
* `clientID` - This is the client ID.
* `clientSecret` - This is the client secret.
* `username` - This is the username you use to log into the web platform/app.
* `password` - This is the password you use to log into the web platform/app.

### Optional Options
* `apiBaseURL` - If the Intesis API URL changes you can set this.  This will default to "https://user.intesishome.com/".
* `grantType` - Best to leave this one alone.  It has to do with the authentication.  It defaults to "password".
* `configCacheSeconds` - This is the number of seconds the plugin will cache the config from Intesis.  This will prevent the plugin from hammering the REST API for the latest config.  Default value is 30.