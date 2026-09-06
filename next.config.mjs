/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Node-only libraries, kept out of the Edge bundle. The mail stack needs
    // Node built-ins such as `stream`, which the Edge runtime does not have.
    serverComponentsExternalPackages: ["imapflow", "mailparser", "nodemailer"],
  },
};

export default nextConfig;
