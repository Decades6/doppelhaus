'use client';

import { useState } from 'react';
import UebersichtTab from '@/components/tabs/UebersichtTab';
import AngebotTab from '@/components/tabs/AngebotTab';
import EigenleistungenTab from '@/components/tabs/EigenleistungenTab';
import KostenTab from '@/components/tabs/KostenTab';
import ZahlungenTab from '@/components/tabs/ZahlungenTab';

const TABS = [
  { id: 'uebersicht',      label: 'Übersicht' },
  { id: 'angebot',         label: 'Angebot' },
  { id: 'eigenleistungen', label: 'Eigenleistungen' },
  { id: 'kosten',          label: 'Kosten' },
  { id: 'zahlungen',       label: 'Zahlungen' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function Dashboard() {
  const [aktuellerTab, setAktuellerTab] = useState<TabId>('uebersicht');

  return (
    <div>
      {/* Tab-Navigation */}
      <div className="flex gap-1 mb-8 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setAktuellerTab(tab.id)}
            className={`flex-1 text-sm font-medium py-2.5 px-3 rounded-lg transition-colors ${
              aktuellerTab === tab.id
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab-Inhalt */}
      {aktuellerTab === 'uebersicht'      && <UebersichtTab onTabWechsel={setAktuellerTab} />}
      {aktuellerTab === 'angebot'         && <AngebotTab />}
      {aktuellerTab === 'eigenleistungen' && <EigenleistungenTab />}
      {aktuellerTab === 'kosten'          && <KostenTab />}
      {aktuellerTab === 'zahlungen'       && <ZahlungenTab />}
    </div>
  );
}
