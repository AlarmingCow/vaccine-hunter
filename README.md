# vaccine-hunter
A thing I made to notify myself that COVID vaccine appointments are available in my area. Uses vaccinespotter.org, which is 👌.

# Setup
I'm a node.js neophyte, I expect this is probably not ideal. But it works! 

Env:
 - Intel Mac (Big Sur)
 - node.js version 15.13.0

```
brew install node
npm install
npm install -g ts-node@9.1.1
```

## Sending SMS Notitifications with AWS SNS
If you want to send SMS notifications, set `notificationType` in the config to `"sms"` and make sure AWS is set up. This involves creating an account, generating API keys, and adding those keys in a `~/.aws/credentials` file.

# Config
Copy `config_template.json` to `config.json` and fill out the fields.

# Running it
To run it once: `ts-node vaccine-hunter.ts`

To check every minute and log results to a file, create crontab line:
```
* * * * * cd <project_root> && mkdir -p log && npm install; /usr/local/bin/ts-node vaccine-hunter.ts >> log/$(/bin/date "+\%Y-\%m-\%d").log
```
Note that using modern Mac OS, you need to grant disk access to `cron` if you want it to work. Also, the commands and files are path dependent and stuff.

# Acknowledgements
Thanks to [@nickblah](https://twitter.com/nickblah) for vaccinespotter.org and the accompanying API. Just wow.