const fs = require('fs');
const files = [
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/AdminPanel.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/BarberOwnerPanel.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/BarberStaffPanel.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/CompanyPanel.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/ui/Skeleton.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/ui/EmptyState.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/ui/Toast.tsx',
    'c:/Users/Rodrigo Weber/Desktop/Projetos/AgentesDeIa/AgenteNFeWpp/apps/web/src/components/ui/Badge.tsx'
];

const replacements = [
    { regex: /bg-white\/\[0\.0[0-9]\]/g, replacement: 'bg-muted/50' },
    { regex: /border-white\/\[0\.0[0-9]\]/g, replacement: 'border-border' },
    { regex: /border-white\/1[0-9]/g, replacement: 'border-border' },
    { regex: /border-white\/2[0-9]/g, replacement: 'border-border' },
    { regex: /text-white\/[0-9]+/g, replacement: 'text-muted-foreground' },
    { regex: /divide-white\/\[0\.0[0-9]\]/g, replacement: 'divide-border' },
    { regex: /hover:bg-white\/\[0\.[0-9]+\]/g, replacement: 'hover:bg-accent' },
    { regex: /hover:bg-white\/[0-9]+/g, replacement: 'hover:bg-accent' },
    { regex: /bg-white\/10/g, replacement: 'bg-muted/50' },
    { regex: /bg-white\/20/g, replacement: 'bg-muted/50' },
    { regex: /bg-white\/5/g, replacement: 'bg-muted/50' },
    { regex: /text-white/g, replacement: 'text-foreground' },
    { regex: /border-white\/5/g, replacement: 'border-border' }
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let newContent = content;
    replacements.forEach(r => {
        newContent = newContent.replace(r.regex, r.replacement);
    });
    if (content !== newContent) {
        fs.writeFileSync(file, newContent);
        console.log('Updated ' + file);
    } else {
        console.log('No change for ' + file);
    }
});
