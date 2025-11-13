import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../services/logger.ts';
import type { ReleaseResult } from '../types/index.ts';

export interface SmartReleaseConfig {
  packageName: string;
  registryUrl: string;
  autoCommit?: boolean;
  autoPush?: boolean;
  tagRelease?: boolean;
  skipPostReleaseTest?: boolean;
}

export class SmartRelease {
  private logger = createLogger({ prefix: 'release' });

  constructor(private config: SmartReleaseConfig) {}

  async run(): Promise<ReleaseResult> {
    try {
      // Check current state
      const currentVersion = await this.getCurrentVersion();
      const publishedVersion = await this.getPublishedVersion();

      this.logger.info(`Current version: ${currentVersion}`);
      this.logger.info(`Published version: ${publishedVersion || 'none'}`);

      // Check if release needed
      if (currentVersion === publishedVersion) {
        const hasChanges = await this.hasChangesSinceLastRelease();

        if (!hasChanges) {
          this.logger.success('No changes detected - package is up to date!');
          return { released: false, version: currentVersion };
        }

        // Bump version
        const newVersion = await this.bumpVersion();
        this.logger.success(`Version bumped to ${newVersion}`);
      }

      // Commit and push if configured
      if (this.config.autoCommit) {
        await this.commitChanges();
      }

      if (this.config.autoPush) {
        await this.pushToRemote();
      }

      // Publish using OCI registry API for better reliability
      await this.publish();
      this.logger.success('Package published successfully!');

      // Verify propagation by checking registry directly
      await this.verifyPropagation();

      // Run post-release test
      if (!this.config.skipPostReleaseTest) {
        await this.runPostReleaseTest();
      }

      return {
        released: true,
        version: await this.getCurrentVersion()
      };

    } catch (error) {
      this.logger.error(`Release failed: ${error}`);
      throw error;
    }
  }

  private async getCurrentVersion(): Promise<string> {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  }

  private async getPublishedVersion(): Promise<string | null> {
    try {
      const result = execSync(
        `npm view ${this.config.packageName} version --registry ${this.config.registryUrl}`,
        { encoding: 'utf-8', stdio: 'pipe' }
      ).trim();
      return result || null;
    } catch {
      // Package doesn't exist yet
      return null;
    }
  }

  private async hasChangesSinceLastRelease(): Promise<boolean> {
    try {
      const lastTag = this.getLastTag();
      if (!lastTag) {
        // No tags, so this is the first release
        return true;
      }

      // Check for changes since last tag
      const changes = execSync(`git diff ${lastTag} --name-only`, { encoding: 'utf-8' });
      const relevantChanges = changes.split('\n').filter(file => {
        // Ignore certain files that don't affect the package
        return file && !file.includes('test/') && 
               !file.includes('docs/') && 
               !file.includes('.md') &&
               !file.includes('.git');
      });

      return relevantChanges.length > 0;
    } catch {
      // If git commands fail, assume changes exist
      return true;
    }
  }

  private getLastTag(): string | null {
    try {
      const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' }).trim();
      return tag || null;
    } catch {
      return null;
    }
  }

  private async bumpVersion(): Promise<string> {
    // Determine version bump type based on commit messages
    const bumpType = await this.determineBumpType();
    
    execSync(`npm version ${bumpType} --no-git-tag-version`, { stdio: 'inherit' });
    
    return this.getCurrentVersion();
  }

  private async determineBumpType(): Promise<'patch' | 'minor' | 'major'> {
    try {
      // Get commits since last tag
      const commits = execSync('git log $(git describe --tags --abbrev=0)..HEAD --oneline', { 
        encoding: 'utf-8' 
      });

      // Simple heuristic: look for keywords in commit messages
      if (commits.includes('BREAKING CHANGE') || commits.includes('!:')) {
        return 'major';
      }
      if (commits.includes('feat:') || commits.includes('feature:')) {
        return 'minor';
      }
      return 'patch';
    } catch {
      // Default to patch if we can't determine
      return 'patch';
    }
  }

  private async commitChanges(): Promise<void> {
    const version = await this.getCurrentVersion();
    
    // Stage version files
    execSync('git add package.json', { stdio: 'inherit' });
    if (existsSync('package-lock.json')) {
      execSync('git add package-lock.json', { stdio: 'inherit' });
    }
    if (existsSync('bun.lockb')) {
      execSync('git add bun.lockb', { stdio: 'inherit' });
    }
    
    // Use m push to handle commit and push
    this.logger.info('Using m push to commit and push changes...');
    execSync(`m push "release: v${version}"`, { stdio: 'inherit' });
    
    if (this.config.tagRelease) {
      execSync(`git tag v${version}`, { stdio: 'inherit' });
      execSync('git push --tags', { stdio: 'inherit' });
    }
  }

  private async pushToRemote(): Promise<void> {
    // This is now handled by m push in commitChanges
    // Keeping empty for backward compatibility
  }

  private async publish(): Promise<void> {
    execSync(
      `npm publish --registry ${this.config.registryUrl}`,
      { stdio: 'inherit' }
    );
  }

  private async verifyPropagation(): Promise<void> {
    const maxAttempts = 10;
    const version = await this.getCurrentVersion();

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.config.registryUrl}/${this.config.packageName}/${version}`);
        if (response.ok) {
          this.logger.success('Package propagation verified!');
          return;
        }
      } catch {
        // Ignore fetch errors, we'll retry
      }

      this.logger.info(`Waiting for propagation... (${i + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.logger.warn('Package propagation timeout - package may still be propagating');
  }

  private async runPostReleaseTest(): Promise<void> {
    this.logger.info('Running post-release verification...');
    
    const testDir = join(process.cwd(), '.post-release-test');
    const version = await this.getCurrentVersion();
    
    try {
      // Create a temporary test directory
      execSync(`rm -rf ${testDir}`, { stdio: 'pipe' });
      execSync(`mkdir -p ${testDir}`, { stdio: 'inherit' });
      
      // Create a test project
      const testPackageJson = {
        name: 'post-release-test',
        version: '1.0.0',
        type: 'module',
        dependencies: {
          [this.config.packageName]: version
        }
      };
      
      writeFileSync(
        join(testDir, 'package.json'), 
        JSON.stringify(testPackageJson, null, 2)
      );
      
      // Create a test script
      const testScript = `#!/usr/bin/env node
import { createCLI, createCommand } from '${this.config.packageName}';

const cli = createCLI({
  name: 'test-cli',
  version: '1.0.0',
  commands: {
    test: createCommand({
      name: 'test',
      description: 'Test command',
      async execute() {
        console.log('Post-release test passed!');
      }
    })
  }
});

// Test that the CLI can be created
console.log('CLI created successfully');
console.log('Package version:', '${version}');
process.exit(0);
`;
      
      writeFileSync(join(testDir, 'test.mjs'), testScript);
      execSync(`chmod +x ${testDir}/test.mjs`, { stdio: 'inherit' });
      
      // Install dependencies
      this.logger.info('Installing package from registry...');
      execSync(
        `cd ${testDir} && npm install --registry ${this.config.registryUrl}`,
        { stdio: 'inherit' }
      );
      
      // Run the test
      this.logger.info('Running verification script...');
      execSync(`cd ${testDir} && node test.mjs`, { stdio: 'inherit' });
      
      // Clean up
      execSync(`rm -rf ${testDir}`, { stdio: 'pipe' });
      
      this.logger.success('Post-release verification passed!');
    } catch (error) {
      // Clean up on failure
      execSync(`rm -rf ${testDir}`, { stdio: 'pipe' });
      throw new Error(`Post-release test failed: ${error}`);
    }
  }
}