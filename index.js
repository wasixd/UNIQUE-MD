console.log("✅ Starting...");
import { join, dirname } from 'path';
import 'module';
import { fileURLToPath } from 'url';
import { setupMaster, fork } from 'cluster';
import { watchFile, unwatchFile } from 'fs';
import cfonts from 'cfonts';
import { createInterface } from 'readline';
import yargs from 'yargs';
import express from 'express';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import { promises as fsPromises } from 'fs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const { say } = cfonts;
const rl = createInterface(process.stdin, process.stdout);
const app = express();
const port = process.env.PORT || 8080;

say("PRINCE-BOT", {
  'font': "pallet",
  'align': 'center',
  'gradient': ["red", "magenta"]
});
say("prince-bot By PrinceGDS", {
  'font': 'console',
  'align': "center",
  'gradient': ['cyan', "magenta"]
});

app.listen(port, () => {
  console.log(chalk.green("🌐 Port " + port + " is open"));
});

var isRunning = false;

async function start(mainScript) {
  if (isRunning) {
    return;
  }
  isRunning = true;
  const currentFilePath = new URL(import.meta.url).pathname;
  let args = [join(currentDir, mainScript), ...process.argv.slice(2)];
  
  say([process.argv[0], ...args].join(" "), {
    'font': "console",
    'align': "center",
    'gradient': ["red", 'magenta']
  });
  
  setupMaster({
    'exec': args[0],
    'args': args.slice(1)
  });
  
  let childProcess = fork();
  
  childProcess.on('message', message => {
    console.log("[RECEIVED]", message);
    switch (message) {
      case "reset":
        childProcess.process.kill();
        isRunning = false;
        start.apply(this, arguments);
        break;
      case 'uptime':
        childProcess.send(process.uptime());
        break;
    }
  });
  
  childProcess.on("exit", (exitCode, signal) => {
    isRunning = false;
    console.error("❎ unexpected error⛔ :", signal);
    start("main.js");
    if (signal === 0) {
      return;
    }
    watchFile(args[0], () => {
      unwatchFile(args[0]);
      start(mainScript);
    });
  });
  
  console.log(chalk.yellow("🖥️ " + os.type() + ", " + os.release() + " - " + os.arch()));
  const totalMemoryGB = os.totalmem() / 1073741824;
  console.log(chalk.yellow("💾 Total RAM: " + totalMemoryGB.toFixed(2) + " GB"));
  const freeMemoryGB = os.freemem() / 1073741824;
  console.log(chalk.yellow("💽 Free RAM: " + freeMemoryGB.toFixed(2) + " GB"));
  console.log(chalk.yellow("📃 Script by PrinceGDS"));
  
  const packageJsonPath = path.join(path.dirname(currentFilePath), "./package.json");
  try {
    const packageJsonContent = await fsPromises.readFile(packageJsonPath, "utf-8");
    const packageInfo = JSON.parse(packageJsonContent);
    console.log(chalk.blue.bold("\n📦 Package Information"));
    console.log(chalk.cyan("Name: " + packageInfo.name));
    console.log(chalk.cyan("Version: " + packageInfo.version));
    console.log(chalk.cyan("Description: " + packageInfo.description));
    console.log(chalk.cyan("Author: " + packageInfo.author.name));
  } catch (error) {
    console.error(chalk.red("❌ Could not read the file package.json: " + error));
  }
  
  console.log(chalk.blue.bold("\n⏰ Current time"));
  const currentTime = new Date().toLocaleString("en-US", {
    'timeZone': "Asia/Karachi"
  });
  console.log(chalk.cyan(currentTime));
  
  setInterval(() => {}, 1000);
  
  let argv = yargs(process.argv.slice(2)).exitProcess(false).parse();
  if (!argv.test) {
    if (!rl.listenerCount()) {
      rl.on("line", input => {
        childProcess.emit('message', input.trim());
      });
    }
  }
}

start("main.js");
