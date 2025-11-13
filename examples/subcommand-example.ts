import { createCLI, type Command } from '../src/index.ts';

// Create the DNS subcommands
const dnsAddCommand: Command = {
  name: 'add',
  description: 'Add a DNS entry',
  args: {
    domain: {
      type: 'string',
      description: 'Domain name to add',
      required: true,
      validate: (value) => {
        if (!value.match(/^[a-zA-Z0-9.-]+$/)) {
          return 'Invalid domain name format';
        }
        return true;
      }
    }
  },
  options: {
    ip: {
      type: 'string',
      description: 'IP address to map to (default: 127.0.0.1)',
      default: '127.0.0.1'
    }
  },
  examples: [
    'dns add myapp.local',
    'dns add myapp.local --ip 192.168.1.100'
  ],
  execute: async ({ args, options }) => {
    const domain = args[0];
    const ip = options.ip || '127.0.0.1';
    console.log(`Adding DNS entry: ${domain} -> ${ip}`);
    // In real implementation, this would modify /etc/hosts
  }
};

const dnsRemoveCommand: Command = {
  name: 'remove',
  description: 'Remove a DNS entry',
  args: {
    domain: {
      type: 'string',
      description: 'Domain name to remove',
      required: true
    }
  },
  examples: [
    'dns remove myapp.local'
  ],
  execute: async ({ args }) => {
    const domain = args[0];
    console.log(`Removing DNS entry: ${domain}`);
    // In real implementation, this would modify /etc/hosts
  }
};

const dnsListCommand: Command = {
  name: 'list',
  description: 'List all managed DNS entries',
  options: {
    format: {
      type: 'string',
      description: 'Output format (table, json)',
      default: 'table'
    }
  },
  examples: [
    'dns list',
    'dns list --format json'
  ],
  execute: async ({ options }) => {
    const format = options.format || 'table';
    console.log(`Listing DNS entries (format: ${format})`);
    // In real implementation, this would read from /etc/hosts
    const entries = [
      { domain: 'myapp.local', ip: '127.0.0.1' },
      { domain: 'api.local', ip: '127.0.0.1' }
    ];
    
    if (format === 'json') {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      console.log('Domain                IP');
      console.log('------                --');
      entries.forEach(entry => {
        console.log(`${entry.domain.padEnd(20)} ${entry.ip}`);
      });
    }
  }
};

// Create the main DNS command with subcommands
const dnsCommand: Command = {
  name: 'dns',
  description: 'Manage DNS entries',
  usage: 'dns <subcommand> [options]',
  examples: [
    'dns add myapp.local',
    'dns remove myapp.local',
    'dns list'
  ],
  subcommands: {
    add: dnsAddCommand,
    remove: dnsRemoveCommand,
    list: dnsListCommand
  }
  // Note: no execute function - requires a subcommand
};

// Create the backup command group as another example
const backupCreateCommand: Command = {
  name: 'create',
  description: 'Create a new backup',
  options: {
    name: {
      type: 'string',
      description: 'Backup name',
      required: true
    }
  },
  execute: async ({ options }) => {
    console.log(`Creating backup: ${options.name}`);
  }
};

const backupRestoreCommand: Command = {
  name: 'restore',
  description: 'Restore from a backup',
  args: {
    name: {
      type: 'string',
      description: 'Backup name to restore',
      required: true
    }
  },
  execute: async ({ args }) => {
    console.log(`Restoring backup: ${args[0]}`);
  }
};

const backupCommand: Command = {
  name: 'backup',
  description: 'Manage backups',
  subcommands: {
    create: backupCreateCommand,
    restore: backupRestoreCommand
  }
};

// Create the CLI with subcommand support
async function main() {
  const cli = createCLI({
    name: 'local-dns',
    version: '1.0.0',
    commands: {
      dns: dnsCommand,
      backup: backupCommand
    }
  });

  await cli.run();
}

if (import.meta.main) {
  main();
}