/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import React from 'react';
import { render } from 'react-dom';
import { ApolloProvider } from '@apollo/client';
import AppErrorBoundary from 'fxa-react/components/AppErrorBoundary';
import sentryMetrics from 'fxa-shared/lib/sentry';
import App from './components/App';
import { AuthContext, createAuthClient } from './lib/auth';
import config, { readConfigMeta, ConfigContext } from './lib/config';
import firefox from './lib/firefox';
import { createApolloClient } from './lib/gql';
import { searchParams } from './lib/utilities';
import { GET_PROFILE_INFO } from './models';
import './index.scss';

try {
  readConfigMeta((name: string) => {
    return document.head.querySelector(name);
  });

  sentryMetrics.configure(config.sentry.dsn, config.version);
  const authClient = createAuthClient(config.servers.auth.url);
  const apolloClient = createApolloClient(config.servers.gql.url);
  const flowQueryParams = searchParams(
    window.location.search
  ) as FlowQueryParams;
  firefox().addEventListener('profile:change', () => {
    apolloClient.query({
      query: GET_PROFILE_INFO,
      fetchPolicy: 'network-only',
    });
  });
  firefox().addEventListener('fxaccounts:delete', () => {
    window.location.assign('/');
  });

  render(
    <React.StrictMode>
      <ApolloProvider client={apolloClient}>
        <AuthContext.Provider value={{ auth: authClient }}>
          <ConfigContext.Provider value={config}>
            <AppErrorBoundary>
              <App {...{ flowQueryParams }} />
            </AppErrorBoundary>
          </ConfigContext.Provider>
        </AuthContext.Provider>
      </ApolloProvider>
    </React.StrictMode>,
    document.getElementById('root')
  );
} catch (error) {
  console.error('Error initializing FXA Settings', error);
}
