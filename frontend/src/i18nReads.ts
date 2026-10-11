import type { Lang } from './i18n'

/** Wording for the read traffic and its balancing across the standbys. */
export const READS: Record<
  Lang,
  {
    appSub: string
    legendWrite: string
    legendRead: string
    served: string
    share: string
    shareHint: string
    none: string
    chart: string
    writesShort: string
    readsShort: string
    healthySub: string
    failing: string
    resumed: string
  }
> = {
  en: {
    appSub: '{writes} writes and {reads} reads per second',
    legendWrite: 'write, to the primary',
    legendRead: 'read, shared between standbys',
    served: 'Reads served',
    share: 'Reads, shared between the standbys',
    shareHint: 'last 30 seconds, by the node that answered',
    none: 'no reads yet',
    chart: 'Second by second, coloured by the node that answered',
    writesShort: 'Writes',
    readsShort: 'Reads',
    healthySub:
      '{leader} takes every write. Reads are shared between the two standbys, which keep a live copy milliseconds behind.',
    failing: 'Reads are failing: no standby is serving them.',
    resumed: 'Reads resumed on {node} after {after} s.',
  },
  fr: {
    appSub: '{writes} écritures et {reads} lectures par seconde',
    legendWrite: 'écriture, vers le primaire',
    legendRead: 'lecture, répartie entre les standbys',
    served: 'Lectures servies',
    share: 'Lectures, réparties entre les standbys',
    shareHint: '30 dernières secondes, selon le nœud qui a répondu',
    none: 'aucune lecture pour l’instant',
    chart: 'Seconde par seconde, coloré selon le nœud qui a répondu',
    writesShort: 'Écritures',
    readsShort: 'Lectures',
    healthySub:
      '{leader} reçoit toutes les écritures. Les lectures sont réparties entre les deux standbys, qui gardent une copie en direct à quelques millisecondes.',
    failing: 'Les lectures échouent : aucun standby ne les sert.',
    resumed: 'Lectures reprises sur {node} après {after} s.',
  },
  ar: {
    appSub: '{writes} كتابات و{reads} قراءات في الثانية',
    legendWrite: 'كتابة، إلى العقدة الرئيسية',
    legendRead: 'قراءة، موزعة بين العقد الاحتياطية',
    served: 'قراءات مُخدَّمة',
    share: 'القراءات، موزعة بين العقد الاحتياطية',
    shareHint: 'آخر 30 ثانية، حسب العقدة التي أجابت',
    none: 'لا قراءات بعد',
    chart: 'ثانية بثانية، ملوّنة حسب العقدة التي أجابت',
    writesShort: 'كتابات',
    readsShort: 'قراءات',
    healthySub:
      '{leader} تستقبل كل الكتابات. القراءات موزعة بين العقدتين الاحتياطيتين، اللتين تحتفظان بنسخة مباشرة متأخرة بأجزاء من الثانية.',
    failing: 'القراءات تفشل: لا توجد عقدة احتياطية تخدمها.',
    resumed: 'استؤنفت القراءات على {node} بعد {after} ث.',
  },
}
