'use strict';
const Alexa = require('alexa-sdk');
const fetch = require('node-fetch');
const https = require('https');
const URL = require('url-parse');
const moment = require('moment-timezone');

const APP_ID = 'amzn1.ask.skill.1e016986-017f-4bb9-9700-f788c11286a3';

const PAGERDUTY_API_ROOT = 'https://api.pagerduty.com';

let accessToken = null;

const UserFacingError = function(message) {
  this.message = message;
  this.toString = function() {
    return this.message;
  };
};

const fetchFromPagerDuty = function(path, options) {
  options = options || {};

  let requestUrl = new URL(PAGERDUTY_API_ROOT);
  requestUrl.set('pathname', path);
  requestUrl.set('query', options.query);

  const headers = {
    'Authorization': 'Bearer ' + accessToken,
    'Accept': 'application/vnd.pagerduty+json;version=2.0'
  };

  const requestUri = requestUrl.toString();
  console.log(requestUri);

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

  console.log(JSON.stringify(event.request));

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

    const oncalls = function(userId, options) {
      options = options || {};
      options.query = options.query || {};
      options.query['user_ids[]'] = userId;
      return fetchFromPagerDuty('/oncalls', options).then(function(oncalls) {
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

    const roleify = function(word, role) {
      role = role || 'NN'; // By default, mark as a noun
      return `<w role="ivona:${role}">${word}</w>`;
    };

    const tellOncalls = function(oncallTells, userName) {
      let forevers = oncallTells[0];
      let endings = oncallTells[1];
      let response = '';

      if (!forevers.length && !endings.length) {
        if (userName) {
          response = `${roleify(userName)} is not on call.`;
        } else {
          response = `${celebrationPhrase()} You are not on call.`;
        }
      } else {
        if (userName) {
          response = `${roleify(userName)} is on call for `;
        } else {
          response = `You are on call for `;
        }

        forevers = forevers.map(roleify);
        endings = endings.map(roleify);

        if (forevers.length > 1) { forevers[forevers.length - 1] = `and ${forevers[forevers.length - 1]}`; }
        response += `${forevers.join(', ')} indefinitely`;
        if (endings.length > 1) { endings[forevers.length - 1] = `and ${endings[forevers.length - 1]}`; }
        if (forevers.length && endings.length) { response += '<break strength="strong"/>, as well as '; }
        response += `${endings.join(', ')}`;
        response += '.';
      }

      alexa.emit(':tell', response);
    };

    const getSinceUntil = function(dateSlot) {
      if (slots.Date.value) {
        // We have to do some trickery to figure out exactly what the user asked for
        // moment.js will represent "Sunday", "next week", or <specific date> all as the same thing, so we need to
        // look at the format used for creation in order ot know what the intent was
        const userDate = moment(dateSlot);
        switch (userDate.creationData().format) {
          case 'YYYY-MM-DD':
            // asked for a specific date, so end at the end of the day
            return {
              since: userDate.toISOString(),
              until: userDate.endOf('day').toISOString()
            };
            break;
          case 'GGGG-[W]WW':
            // asked for a week or a weekend
            if (userDate.creationData().input.indexOf('WE') != -1) {
              // TODO: not terribly locale aware, but the best we can do here is ask for day 6 (Saturday)
              return {
                since: userDate.day(6).toISOString(),
                until: userDate.add(1, 'week').day(1).endOf('day').toISOString()
              };
            } else {
              return {
                since: userDate.toISOString(),
                until: userDate.endOf('week').toISOString()
              };
            }
            break;
          case 'YYYY-MM':
            // asked for a specific month, so end at the end of the month
            return {
              since: userDate.toISOString(),
              until: userDate.endOf('month').toISOString()
            };
            break;
          case undefined:
            // moment doesn't handle all Amazon dates, like "next year", "this spring"
            // but these don't make a lot of sense in this application
            console.log(`Overly-general date asked for: ${userDate.creationData().input}`);
            throw new UserFacingError('Sorry, I need a more specific date. Please ask again.');
            break;
          default:
            console.error(`Unexpected date format received from Amazon: ${userDate.creationData().input}`);
            throw new UserFacingError('Sorry, I was unable to figure out what date you asked for. Please ask again.');
        }
      }
    };

    let oncallOptions = {};

    oncallOptions.query = getSinceUntil(slots.Date.value);

    switch(slots.User.value) {
      case 'I':
        fetchFromPagerDuty('/user')
          .then((user) => {
            return oncalls(user.user.id, oncallOptions).then((oncalls) => {
              return tellOncalls(oncallTells(oncalls, user.user.time_zone));
            });
          });
        break;
      case undefined:
        alexa.emit(':tell', `Sorry, I didn't understand which user you asked for.`);
        break;
      default:
        fetchFromPagerDuty('/users', {
          query: {
            'query': slots.User.value,
            limit: 5
          }
        }).then((users) => {
          const spokenUser = roleify(slots.User.value);
          if (users.more) {
            alexa.emit(':tell', `I found too many users matching <break strength="weak"/>"${spokenUser}". Please try again with the person's full name.`);
          } else if (users.users.length == 0) {
            alexa.emit(':tell', `Sorry, I couldn't find the user <break strength="weak"/>"${spokenUser}"`);
          } else if (users.users.length != 1) {
            let foundNames = users.users.map((user) => { return user.name; }).map(roleify);
            foundNames[foundNames.length - 1] = `or ${foundNames[foundNames.length - 1]}`;
            alexa.emit(':tell', `I found a few users matching <break strength="weak"/>"${spokenUser}". Did you mean ${foundNames.join(', ')}?`);
          } else {
            return oncalls(users.users[0].id, oncallOptions).then((oncalls) => {
              return tellOncalls(oncallTells(oncalls, users.users[0].time_zone), users.users[0].name);
            });
          }
        });
        break;
    }
  },
  'AMAZON.HelpIntent': function () {
    const speechOutput = 'You can ask me if you or another user is currently on call.';
    const reprompt = 'What can I help you with?';
    this.emit(':ask', speechOutput, reprompt);
  },
  'AMAZON.CancelIntent': function () {
    this.emit('Exit');
  },
  'AMAZON.StopIntent': function () {
    this.emit('Exit');
  },
  'SessionEndedRequest': function () {
    if (this.event.request.reason == 'ERROR') {
      this.emit(':tell', 'Oops! Something went wrong. Please try again.');
    }
    this.emit('Exit');
  },
  'Exit': function() {
    this.emit(':responseReady');
  }
};
