#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

// Get all files recursively, excluding .cursor folder
function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  files.forEach((file) => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    // Skip .cursor folder
    if (stat.isDirectory() && file === ".cursor") {
      return;
    }

    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });

  return fileList;
}

// Bump version based on type
function bumpVersion(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);

  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}`);
  }
}

// Ask user for bump type
function askBumpType(currentVersion) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const majorVersion = bumpVersion(currentVersion, "major");
  const minorVersion = bumpVersion(currentVersion, "minor");
  const patchVersion = bumpVersion(currentVersion, "patch");

  return new Promise((resolve) => {
    rl.question(
      `Bump type (major (${majorVersion}), minor (${minorVersion}), patch (${patchVersion}) [default: patch]): `,
      (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        // Default to patch if empty
        const type = trimmed || "patch";
        if (!["major", "minor", "patch"].includes(type)) {
          console.error(`Invalid bump type: ${type}. Must be major, minor, or patch.`);
          process.exit(1);
        }
        resolve(type);
      }
    );
  });
}

// Main function
async function main() {
  // Read package.json
  const packageJsonPath = join(repoRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const currentVersion = packageJson.version;

  console.log(`Current version: ${currentVersion}`);

  // Ask for bump type
  const bumpType = await askBumpType(currentVersion);
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`New version: ${newVersion}`);

  // Update package.json
  packageJson.version = newVersion;
  writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
    "utf-8"
  );
  console.log(`✓ Updated package.json`);

  // Update package-lock.json
  const packageLockJsonPath = join(repoRoot, "package-lock.json");
  const packageLockJson = JSON.parse(readFileSync(packageLockJsonPath, "utf-8"));
  packageLockJson.version = newVersion;
  if (packageLockJson.packages && packageLockJson.packages[""]) {
    packageLockJson.packages[""].version = newVersion;
  }
  writeFileSync(
    packageLockJsonPath,
    JSON.stringify(packageLockJson, null, 2) + "\n",
    "utf-8"
  );
  console.log(`✓ Updated package-lock.json`);

  // Find and replace swimple@X.X.X in all files
  const files = getAllFiles(repoRoot);
  const versionPattern = /swimple@\d+\.\d+\.\d+/g;
  let filesUpdated = 0;

  files.forEach((filePath) => {
    try {
      const content = readFileSync(filePath, "utf-8");
      if (versionPattern.test(content)) {
        const updatedContent = content.replace(
          versionPattern,
          `swimple@${newVersion}`
        );
        writeFileSync(filePath, updatedContent, "utf-8");
        const relativePath = relative(repoRoot, filePath);
        console.log(`✓ Updated ${relativePath}`);
        filesUpdated++;
      }
    } catch (error) {
      // Skip binary files or files we can't read
      if (error.code !== "EISDIR") {
        console.warn(`Warning: Could not process ${filePath}: ${error.message}`);
      }
    }
  });

  console.log(`\n✓ Version bump complete!`);
  console.log(`  Updated ${filesUpdated} file(s)`);
  console.log(`  Version: ${currentVersion} → ${newVersion}`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
