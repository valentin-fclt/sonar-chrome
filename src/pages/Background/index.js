// This script runs in the background of the extension. It is responsible for listening to tab changes and sending "visit" events to the Sonar API if the user visits one of the tracked domain.

import psl from 'psl'; // Library to parse domain names - https://www.npmjs.com/package/psl

import trackedDomainsList from '../../assets/json/trackedDomains.json'; // List of domains to track.
import authCookiesList from '../../assets/json/authCookies.json'; // List of some commonly-used standard authentication cookie names (e.g. "token", "email", "auth", etc..")

import { SONAR_API_URL } from '../../constants'; // URL of the Sonar API

let userEmail = null; // User's Google account email. Will be fetched via the Chrome.identity API.
let userId = null; // User's Google account ID. Will be fetched via the Chrome.identity API.

let visitEventsTracked = new Map(); // Map of visit events that have been tracked. Used to make sure that we send no more than one visit event per domain per day.

// Function to check if the domain is in the list of tracked domains
const websiteIsTracked = (domain) => trackedDomainsList.includes(domain);

// Function to check if the domain has any of the standard authentication cookies listed in authCookiesList
const websiteHasLoginCookiesForUser = async (domain) => {
  let authCookieFound = false;

  // Loop through all cookies for the domain and check if any of them is in the list of standard authentication cookies
  const cookies = await chrome.cookies.getAll({ domain });
  cookieLoop: for (const cookie of cookies) {
    for (const authCookie of authCookiesList) {
      if (
        new RegExp(authCookie, 'i').test(cookie.name) &&
        cookie.value != null &&
        cookie.value?.includes('false') === false &&
        cookie.value !== false &&
        cookie.value !== 'no' &&
        cookie.value !== 'n' &&
        cookie.value?.includes('undefined') === false &&
        cookie.value?.includes('null') === false &&
        cookie.value?.includes('unspecified') === false
      ) {
        authCookieFound = true;
        break cookieLoop;
      }
    }
  }

  return authCookieFound;
};

// Function to send a website visit event to the API.
const sendSaasVisitEvent = (domain, hasAuthCookies) => {
  const visitEvent = {
    userId,
    userEmail,
    domain,
    hasAuthCookies,
    date: new Date(),
  };

  fetch(SONAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(visitEvent),
  })
    .then(() => {
      console.log(
        `"Visit" event generated for domain "${domain}" by user "${userEmail} (${userId})". hasAuthCookies: "${hasAuthCookies}"`
      );

      visitEventsTracked.set(domain, {
        date: visitEvent.date,
        hasAuthCookies: visitEvent.hasAuthCookies,
      });
    })
    .catch((error) =>
      console.log(
        `Error while generating a "visit" event for domain "${domain}" by user "${userEmail} (${userId})". hasAuthCookies: "${hasAuthCookies}"`,
        error
      )
    );
};

// Function to start tracking the user's browsing activity and sending visit events to the Sonar API if the user visits one of the tracked domains.
const startTracking = async () => {
  try {
    console.log('Starting Sonar tracking...');

    // Get the user's Google account email and ID
    const info = await chrome.identity.getProfileUserInfo();
    userEmail = info?.email;
    userId = info?.id;

    if (!userEmail || !userId)
      throw new Error(
        `Could not get user's Google account info using the Chrome.identity API`
      );
    else console.log(`Logged in Google user: ${userEmail} (${userId})`);

    // Listen to tab changes. Every time the url changes, check if a visit event shall be generated
    await chrome.tabs.onUpdated.addListener(async (_, changeInfo) => {
      const url = changeInfo?.url ? new URL(changeInfo.url) : null;
      const hostName = url?.hostname;
      const domain = hostName ? psl.parse(hostName)?.domain : null;

      // If the domain is in the list of tracked domains, send a "visit" event to the Sonar API
      if (domain && websiteIsTracked(domain)) {
        const websiteHasAuthCookie = await websiteHasLoginCookiesForUser(
          domain
        );
        const existingVisitEventHasAuthCookie =
          visitEventsTracked.get(domain)?.hasAuthCookies;
        const existingVisitEventDate = visitEventsTracked
          .get(domain)
          ?.date?.getDate();
        const currentDate = new Date().getDate();

        // Only send a "visit" event if: 1) the domain has not been visited yet today, or 2) the domain has been visited today but the user's authentication status has changed since the last visit
        if (
          !visitEventsTracked.has(domain) ||
          (websiteHasAuthCookie === false &&
            existingVisitEventHasAuthCookie === true) ||
          (websiteHasAuthCookie === true &&
            existingVisitEventHasAuthCookie === false) ||
          existingVisitEventDate !== currentDate
        ) {
          sendSaasVisitEvent(domain, websiteHasAuthCookie);
          return;
        }
      }
    });

    console.log('Sonar tracking successfully started.');
  } catch (err) {
    console.error('Error while starting tracking.', err);
  }
};

// Start tracking
startTracking();
