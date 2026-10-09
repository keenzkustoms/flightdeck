#!/bin/sh
set -e
UNIT=/home/flightdeck/flightdeck/printshelf/printshelf.service
docker run --rm \
  -v /etc/sudoers.d:/sd \
  -v /etc/systemd/system:/sysd \
  -v "$UNIT:/unit:ro" \
  alpine sh -c "cp /unit /sysd/printshelf.service && printf '%s\n' 'flightdeck ALL=(root) NOPASSWD: /usr/bin/systemctl restart flightdeck.service, /usr/bin/systemctl status flightdeck.service, /usr/bin/systemctl is-active flightdeck.service, /usr/bin/systemctl daemon-reload, /usr/bin/systemctl enable printshelf.service, /usr/bin/systemctl disable printshelf.service, /usr/bin/systemctl start printshelf.service, /usr/bin/systemctl stop printshelf.service, /usr/bin/systemctl restart printshelf.service, /usr/bin/systemctl status printshelf.service, /usr/bin/systemctl is-active printshelf.service' > /sd/flightdeck-restart && chmod 440 /sd/flightdeck-restart && ls -la /sysd/printshelf.service && cat /sd/flightdeck-restart"
