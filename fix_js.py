import re

for filepath in ['c:/Users/user/Antigravity/speak-ai-tutor/app.js', 'c:/Users/user/Antigravity/speak-ai-tutor/frontend/app.js']:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace className setting
    content = content.replace("statusBadge.className = 'status-badge ' + state;", "statusBadge.className = 'status-badge status-' + state;")

    # Replace connected button text
    content = content.replace("btnText.textContent = '結束對話並查看成績單';", "btnText.textContent = '結束對話';")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
