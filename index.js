'use strict';
const Alexa = require('alexa-sdk');
const fetch = require('node-fetch');
const https = require('https');
const URL = require('url-parse');
const moment = require('moment-timezone');

const APP_ID = 'amzn1.ask.skill.1e016986-017f-4bb9-9700-f788c11286a3';

const PAGERDUTY_API_ROOT = 'https://api.pagerduty.com';

let accessToken = null;

const fetchFromPagerDuty = function(path, options) {
  options = options || {};

  let requestUrl = new URL(PAGERDUTY_API_ROOT);
  requestUrl.set('pathname', path);
  requestUrl.set('query', options.query);

  const headers = {
    'Authorization': 'Bearer ' + accessToken,
    'Accept': 'application/vnd.pagerduty+json;version=2.0'
  };

  return fetch(requestUrl.toString(), {
    headers: headers
  }).then(function(response) {
    const json = response.json();
    if (response.ok) {
      return json;
    } else {
      console.log(response.status);
      console.log(response.statusText);
      return json.then(Promise.reject.bind(Promise));
    }
  }).catch(function(error) {
    console.log(error);
    return Promise.reject(error);
  });
};

exports.handler = function(event, context) {
  const alexa = Alexa.handler(event, context);

  accessToken = event.session.user.accessToken;

  alexa.appId = APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
  'LaunchRequest': function () {
    this.emit('OnCall');
  },
  'OnCallIntent': function () {
    this.emit('OnCall');
  },
  'OnCall': function () {
    const alexa = this;

    const slots = alexa.event.request.intent.slots;

    const oncalls = function(userId) {
      return fetchFromPagerDuty('/oncalls', {
        query: {
          'user_ids[]': userId
        }
      }).then(function(oncalls) {
        let filteredOncalls = oncalls.oncalls;

        const scheduleOnly = true;
        const firstLevelOnly = true;
        if (scheduleOnly) {
          filteredOncalls = filteredOncalls.filter((oncall) => { return oncall.schedule !== null; });
        }
        if (firstLevelOnly) {
          filteredOncalls = filteredOncalls.filter((oncall) => { return oncall.escalation_level == 1; });
        }

        return filteredOncalls;
      });
    };

    const oncallTells = function(oncalls, timeZone) {
      let forevers = [];
      let endings = [];

      oncalls.forEach((oncall) => {
        const untilTime = moment.tz(oncall.end, timeZone);
        if (untilTime.diff(moment(), 'months', true) > 3) {
          forevers.push(oncall.escalation_policy.summary);
        } else {
          endings.push(`${oncall.escalation_policy.summary} until ${untilTime.calendar()}`);
        }
      });

      return [forevers, endings];
    };

    const celebrationPhrase = function() {
      const phrases = [
        'Rad!',
        'Awesome!',
        'Neat-o!',
        'Yee-haw!',
        'Hot Diggity!',
        'Huzzah!',
        'Cowabunga!',
        'Wonderful!'
      ];
      return phrases[Math.floor(Math.random() * phrases.length)];
    };

    const tellOncalls = function(oncallTells) {
      let forevers = oncallTells[0];
      let endings = oncallTells[1];
      let response = '';

      if (!forevers.length && !endings.length) {
        response = `${celebrationPhrase()} You are not on call.`;
      } else {
        response = 'You are on call for ';
        if (forevers.length > 1) { forevers[forevers.length - 1] = `and ${forevers[forevers.length - 1]}`; }
        response += `${forevers.join(', ')} indefinitely`;
        if (endings.length > 1) { endings[forevers.length - 1] = `and ${endings[forevers.length - 1]}`; }
        if (forevers.length && endings.length) { response += '<break strength="strong"/>, as well as '; }
        response += `${endings.join(', ')}`;
        response += '.';
      }

      alexa.emit(':tell', response);
    };

    switch(slots.User.value) {
      case 'I':
        fetchFromPagerDuty('/user')
          .then((user) => {
            return oncalls(user.user.id).then((oncalls) => {
              return tellOncalls(oncallTells(oncalls, user.user.time_zone));
            });
          });
        break;
      default:
        // TODO support other users
        alexa.emit(':tell', `Sorry, I couldn't find the user <break strength="weak"/>"${slots.User.value}"`);
        break;
    }
  },
  'AMAZON.HelpIntent': function () {
    const speechOutput = 'You can ask me if you are currently on call.';
    const reprompt = 'What can I help you with?';
    this.emit(':ask', speechOutput, reprompt);
  },
  'AMAZON.CancelIntent': function () {
    this.emit(':tell', 'Goodbye!');
  },
  'AMAZON.StopIntent': function () {
    this.emit(':tell', 'Goodbye!');
  }
};
