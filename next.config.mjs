import createMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Help Center articles live in content/help as .mdx
  pageExtensions: ['js', 'jsx', 'md', 'mdx'],
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
