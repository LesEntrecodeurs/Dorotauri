import React, { useState, useRef } from 'react';
import { User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { AgentCharacter } from '@/types/electron';
import type { AgentPersonaValues } from './types';
import { CHARACTER_OPTIONS } from './constants';

const AgentPersonaEditor = React.memo(function AgentPersonaEditor({
  projectPath,
  onChange,
  initialCharacter,
  initialName,
}: {
  projectPath: string;
  onChange: (v: AgentPersonaValues) => void;
  initialCharacter?: AgentCharacter;
  initialName?: string;
}) {
  const [character, setCharacter] = useState<AgentCharacter>(initialCharacter || 'robot');
  const [name, setName] = useState(initialName || '');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleCharacterChange = (id: AgentCharacter) => {
    setCharacter(id);
    onChangeRef.current({ character: id, name });
  };

  const handleNameChange = (value: string) => {
    setName(value);
    onChangeRef.current({ character, name: value });
  };

  const projectName = projectPath.split('/').pop() || 'project';
  const charLabel = CHARACTER_OPTIONS.find(c => c.id === character)?.name || 'Agent';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-2 flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          Agent Persona
        </label>
        <div className="flex gap-1.5">
          {CHARACTER_OPTIONS.map((char) => (
            <button
              key={char.id}
              onClick={() => handleCharacterChange(char.id)}
              title={char.name}
              className={`
                w-10 h-10 border transition-all flex items-center justify-center rounded-md
                ${character === char.id
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                  : 'border-border hover:border-primary bg-muted/30'
                }
              `}
            >
              <span className="text-lg">{char.emoji}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">Agent Name (optional)</label>
        <Input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder={`${charLabel} on ${projectName}`}
        />
      </div>
    </div>
  );
});

export default AgentPersonaEditor;
