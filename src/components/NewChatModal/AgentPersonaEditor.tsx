import React, { useState, useRef, useCallback } from 'react';
import type { AgentCharacter } from '@/types/electron';
import type { AgentPersonaValues } from './types';
import { CHARACTER_OPTIONS, getRandomChampion, getChampionIconUrl } from './constants';

const AgentPersonaEditor = React.memo(function AgentPersonaEditor({
  onChange,
  initialCharacter,
  initialName,
}: {
  onChange: (v: AgentPersonaValues) => void;
  initialCharacter?: AgentCharacter;
  initialName?: string;
}) {
  const [character, setCharacter] = useState<AgentCharacter>(initialCharacter || 'robot');
  const [name, setName] = useState(initialName || '');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleReroll = useCallback(() => {
    const next = getRandomChampion();
    setCharacter(next.character);
    setName(next.name);
    onChangeRef.current({ character: next.character, name: next.name });
  }, []);

  const iconUrl = getChampionIconUrl(name);
  const currentChar = CHARACTER_OPTIONS.find(c => c.id === character);

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">Agent Name</label>
      <div className="flex gap-2">
        <div className="flex-1 h-10 px-3 flex items-center gap-2 border border-border rounded-md bg-muted/30 text-sm">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />
          ) : (
            <span className="text-base shrink-0">{currentChar?.emoji}</span>
          )}
          <span>{name || currentChar?.name || 'Agent'}</span>
        </div>
        <button
          onClick={handleReroll}
          title="Reroll random champion"
          className="flex-shrink-0 w-10 h-10 border border-border hover:border-primary bg-muted/30 hover:bg-primary/10 rounded-md flex items-center justify-center transition-all text-base"
        >
          🎲
        </button>
      </div>
    </div>
  );
});

export default AgentPersonaEditor;
