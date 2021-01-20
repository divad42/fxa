import React from 'react';
import ReactDOM from 'react-dom';

import './index.scss';

export const PaypalButton = paypal.Buttons.driver('react', {
  React,
  ReactDOM,
});

export default PaypalButton;
