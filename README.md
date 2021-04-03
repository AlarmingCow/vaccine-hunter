# vaccine-hunter
A thing I made to notify myself that COVID vaccine appointments are available in my area.

# Setup
I'm a node.js neophyte, I expect this is probably terrible. 

Env:
 - Intel Mac (Big Sur)
 - node.js version 15.13.0

```
brew install node
npm install --save-dev got@11.8.2
npm install --save-dev @types/node@14.14.37
npm install --save-dev haversine@1.1.4
npm install -g ts-node@9.1.1
npm install -g typescript@4.2.3
```

# Config
Copy `config_template.json` to `config.json` and fill out the fields.

# Running it
To run it once: `ts-node vaccine-hunter.ts`

To check every minute and log results to a file, create crontab line:
```
* * * * * cd <project_root> && mkdir -p log && ts-node vaccine-hunter.ts >> log/$(date +%Y-%m-%d).log
```