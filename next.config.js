/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  importScripts: ['/push-sw.js'],
  disable: process.env.NODE_ENV === 'development'
});

const nextConfig = {
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
};

module.exports = withPWA(nextConfig);
