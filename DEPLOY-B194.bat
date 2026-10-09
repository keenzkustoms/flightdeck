@echo off
cd /d C:\Users\Kidabah\flightdeck
git add makerforge
git commit -m "Fix canister 3MF: single AMS mesh, embedded art/text (b194)"
git push origin main
ssh -i C:\Users\Kidabah\.ssh\flightdeck_cursor -o IdentitiesOnly=yes flightdeck@100.106.112.104 "cd /home/flightdeck/flightdeck && git pull && sudo systemctl restart flightdeck.service"
echo Hard refresh MakerDeck - need b194 - then re-export coffee jar
pause
