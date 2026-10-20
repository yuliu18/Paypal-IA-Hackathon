import { describe, expect, it } from 'vitest';
import { demoAccess } from './demo-auth';

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('demoAccess', () => {
  it('lets in a request with the demo password, whatever the user name', () => {
    expect(demoAccess({ authorization: basic('judge', 's3cret'), password: 's3cret', production: true })).toBe('allow');
    expect(demoAccess({ authorization: basic('', 's3cret'), password: 's3cret', production: true })).toBe('allow');
  });

  it('accepts a password that contains a colon', () => {
    expect(demoAccess({ authorization: basic('judge', 'a:b'), password: 'a:b', production: true })).toBe('allow');
  });

  it('asks for credentials when they are missing or wrong', () => {
    expect(demoAccess({ authorization: null, password: 's3cret', production: true })).toBe('challenge');
    expect(demoAccess({ authorization: basic('judge', 'nope'), password: 's3cret', production: true })).toBe('challenge');
    expect(demoAccess({ authorization: 'Bearer s3cret', password: 's3cret', production: true })).toBe('challenge');
    expect(demoAccess({ authorization: 'Basic %%%not-base64', password: 's3cret', production: true })).toBe('challenge');
  });

  it('refuses everything in production when no password is configured', () => {
    expect(demoAccess({ authorization: basic('judge', ''), password: undefined, production: true })).toBe('unconfigured');
    expect(demoAccess({ authorization: null, password: '', production: true })).toBe('unconfigured');
  });

  it('stays open in local development when no password is configured', () => {
    expect(demoAccess({ authorization: null, password: undefined, production: false })).toBe('allow');
  });

  it('still requires the password in development once one is configured', () => {
    expect(demoAccess({ authorization: null, password: 's3cret', production: false })).toBe('challenge');
  });
});
