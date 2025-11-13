#!/usr/bin/env node

import { createCLI } from '../src/index.ts';

// Smart argument parser for proxy CLI
function customRouter(args: string[]) {
  // Handle special commands first
  if (args[0] === 'websites') {
    return { command: 'websites', args: args.slice(1) };
  }

  if (args[0] === 'jobs') {
    return { command: 'jobs', args: args.slice(1) };
  }

  // For everything else, use intelligent argument detection
  const parsed = {
    count: 10,      // default
    protocol: 'any', // default
    country: 'US',   // default
    website: undefined
  };

  for (const arg of args) {
    if (/^\d+$/.test(arg)) {
      parsed.count = parseInt(arg);
    } else if (['http','https','socks4','socks5','any'].includes(arg.toLowerCase())) {
      parsed.protocol = arg.toLowerCase();
    } else if (/^[A-Z]{2}$/i.test(arg)) {
      parsed.country = arg.toUpperCase();
    } else if (arg.includes('.')) {
      parsed.website = arg;
    }
  }

  return {
    command: 'get',
    args: [parsed.count.toString(), parsed.protocol, parsed.country, parsed.website].filter(Boolean)
  };
}

const cli = createCLI({
  name: 'p',
  version: '1.0.0',
  description: 'Proxy management CLI with intelligent argument parsing',
  
  // Custom routing for flexible argument parsing
  customRouter,
  
  // Default to 'get' command when no command matches
  defaultCommand: 'get',
  
  commands: {
    get: {
      name: 'get',
      description: 'Get proxies with intelligent argument parsing',
      usage: 'p [count] [protocol] [country] [website]',
      examples: [
        'p                     # 10 proxies, any protocol, US',
        'p 5                   # 5 proxies, any protocol, US', 
        'p 20 https            # 20 HTTPS proxies, US',
        'p US 10 http          # 10 HTTP proxies from US',
        'p 5 craigslist.com    # 5 proxies tested on Craigslist',
        'p https 3 airbnb.com  # 3 HTTPS proxies for Airbnb',
        'p DE 15 any           # 15 proxies from Germany',
        'p UK https 8          # 8 HTTPS proxies from UK'
      ],
      async execute({ args, registry }) {
        const [count = '10', protocol = 'any', country = 'US', website] = args;
        
        console.log(`Getting ${count} ${protocol} proxies from ${country}${website ? ` for ${website}` : ''}`);
        
        // Simulate getting proxies
        const proxies = Array.from({ length: parseInt(count) }, (_, i) => ({
          ip: `192.168.1.${i + 1}`,
          port: 8080 + i,
          protocol,
          country
        }));
        
        console.log('Found proxies:');
        proxies.forEach(proxy => {
          console.log(`  ${proxy.protocol}://${proxy.ip}:${proxy.port} (${proxy.country})`);
        });
      }
    },
    
    websites: {
      name: 'websites',
      description: 'List supported websites',
      async execute() {
        console.log('Supported websites:');
        console.log('  - craigslist.com');
        console.log('  - airbnb.com'); 
        console.log('  - facebook.com');
        console.log('  - instagram.com');
      }
    },
    
    jobs: {
      name: 'jobs',
      description: 'Manage background jobs',
      usage: 'p jobs <action> [job]',
      examples: [
        'p jobs list           # List all jobs',
        'p jobs enable ping    # Enable ping job',
        'p jobs disable ping   # Disable ping job'
      ],
      async execute({ args }) {
        const [action, job] = args;
        
        switch (action) {
          case 'list':
            console.log('Background jobs:');
            console.log('  - ping: enabled (every 10min)');
            console.log('  - functional-check: enabled (every 10min)');
            console.log('  - import-and-check: enabled (every 15min)');
            break;
          case 'enable':
            console.log(`Enabling job: ${job}`);
            break;
          case 'disable':
            console.log(`Disabling job: ${job}`);
            break;
          default:
            console.log('Available actions: list, enable, disable');
        }
      }
    }
  }
});

// Test the CLI with various argument patterns
if (import.meta.main) {
  const testCases = [
    [],                        // Default: p
    ['5'],                     // p 5
    ['20', 'https'],           // p 20 https
    ['US', '10', 'http'],      // p US 10 http (order flexible)
    ['5', 'craigslist.com'],   // p 5 craigslist.com
    ['https', '3', 'airbnb.com'], // p https 3 airbnb.com (order flexible)
    ['DE', '15', 'any'],       // p DE 15 any
    ['UK', 'https', '8'],      // p UK https 8 (order flexible)
    ['websites'],              // p websites
    ['jobs', 'list'],          // p jobs list
    ['jobs', 'enable', 'ping'] // p jobs enable ping
  ];
  
  console.log('Testing proxy CLI with various argument patterns:\n');
  
  for (const testArgs of testCases) {
    console.log(`\n--- Testing: p ${testArgs.join(' ')} ---`);
    try {
      await cli.run(testArgs);
    } catch (error) {
      console.error(`Error: ${error}`);
    }
    console.log('');
  }
}

export default cli;