import type { DemoEvent, Mode, Phase, Status } from './types'

export type Lang = 'en' | 'fr' | 'ar'

type Vars = Record<string, string | number | null | undefined>

const en = {
  title: 'PostgreSQL high availability',
  subtitle: 'Three nodes, one primary, zero manual steps',
  live: 'LIVE',
  app: 'Your application',
  appSub: '{rate} writes per second',
  router: 'Router',
  routerSub: 'always points to the primary',
  etcd: 'etcd',
  etcdSub: 'leader lock',
  wal: 'live copy (WAL)',
  lockExpires: 'lock expires in {ttl} s',
  status: {
    unknown: 'Waiting',
    starting: 'Starting',
    primary: 'Primary',
    standby: 'Standby',
    catching_up: 'Catching up',
    waiting: 'Waiting',
    demoting: 'Stepping down',
    down: 'Down',
    isolated: 'Cut off',
  } as Record<Status, string>,
  roleHint: {
    primary: 'takes every write',
    standby: 'live copy, ready to take over',
    catching_up: 'copying what it missed',
    waiting: 'no primary to follow yet',
    demoting: 'giving up the primary role',
    starting: 'starting PostgreSQL',
    unknown: '',
    down: '',
    isolated: 'no network',
  } as Record<Status, string>,
  modeDown: { crash: 'Power cut', stop: 'Shut down', isolate: 'Network cut' } as Record<Mode, string>,
  actions: { crash: 'Power cut', stop: 'Shut down', isolate: 'Cut network' } as Record<Mode, string>,
  actionHint: {
    crash: 'Kill it instantly, like a power failure',
    stop: 'Shut it down cleanly, like maintenance',
    isolate: 'Unplug it from the network; it keeps running',
  } as Record<Mode, string>,
  bringBack: 'Bring it back',
  latestWrite: 'Latest write',
  lag: 'Behind',
  inSync: 'in sync',
  timeline: 'Timeline',
  insideView: 'Seen from inside: {role}',
  insideRole: { primary: 'still primary', replica: 'read-only replica' } as Record<string, string>,
  confirmed: 'Confirmed writes',
  confirmedHint: 'the database said "saved"',
  interrupted: 'Interrupted writes',
  interruptedHint: 'refused or timed out while it switched; the app retries',
  lost: 'Confirmed writes lost',
  lostPending: 'checked after each incident',
  lostDone: 'checked {when}',
  pause: 'Last write pause',
  pauseNone: 'none yet',
  seconds: '{n} s',
  primaryNow: 'Primary now',
  events: 'What just happened',
  noEvents: 'Break a node to see the cluster heal itself.',
  writesChart: 'Writes, second by second, coloured by the node that saved them',
  failedLegend: 'interrupted',
  verify: 'Check every write',
  reset: 'Reset counters',
  readOnly: 'View only',
  autoRecover: 'A node left down returns on its own after {n} s.',
  justNow: 'just now',
  agoS: '{n} s ago',
  phase: {
    starting: ['Starting the cluster', 'Three PostgreSQL nodes are electing their first primary.'],
    healthy: [
      'All systems normal',
      '{leader} takes every write. The two others keep a live copy, milliseconds behind, ready to take over.',
    ],
    waiting_lock: [
      '{node} is down. Writes are on hold.',
      'Its leader lock expires in {ttl} s. Only then may a standby take over: two primaries can never exist.',
    ],
    electing: ['Electing a new primary', 'The standby holding the most recent data takes the leader lock.'],
    switching: ['{node} is the new primary', 'The router is moving the application over to it.'],
    degraded: [
      '{node} is down. Service continues on {leader}.',
      'Writes are flowing again. Bring {node} back to restore full redundancy.',
    ],
    degraded_isolate: [
      '{node} is cut off. Service continues on {leader}.',
      'Unable to reach the lock, {node} stepped down to read-only on its own, so it can never accept a stray write.',
    ],
    degraded_isolate_pending: [
      '{node} is cut off. Service continues on {leader}.',
      'Nothing can reach {node} any more, so no write can land on it. Once it gives up on the lock, it steps down to read-only on its own.',
    ],
    rejoining: [
      '{node} is rejoining as a standby',
      'It rewinds any history that diverged, then copies everything it missed from {leader}.',
    ],
    recovered: ['Recovered. Full redundancy restored.', 'Writes paused for {outage} s. Confirmed writes lost: {lost}.'],
  } as Record<string, [string, string]>,
  ev: {
    ready: 'Cluster ready. The application starts writing.',
    leader: '{node} is the primary.',
    failure_crash: 'Power cut on {node}.',
    failure_stop: '{node} is shutting down.',
    failure_isolate: '{node} is cut off the network.',
    node_down: '{node} stopped answering.',
    writes_failing: 'Writes are failing: no primary reachable.',
    lock_expired: "{node}'s leader lock expired.",
    lock_released: '{node} handed back its leader lock.',
    promoted: '{node} promoted to primary.',
    writes_resumed: 'Writes resumed on {node} after {after} s.',
    writes_moved: 'Writes now land on {node}.',
    demoted_self: '{node} stepped down to read-only by itself.',
    demoting: '{node} is stepping down.',
    recover: '{node} is back online.',
    recover_auto: '{node} brought back automatically.',
    node_back: '{node} is answering again.',
    rejoined: '{node} is a standby again, streaming from the primary.',
    verified: 'Checked {acked} confirmed writes: {missing} lost.',
    healthy: 'Cluster fully healthy again.',
    reset: 'Counters reset.',
  } as Record<string, string>,
}

type Dict = typeof en

const fr: Dict = {
  title: 'PostgreSQL haute disponibilité',
  subtitle: 'Trois nœuds, un primaire, aucune intervention manuelle',
  live: 'EN DIRECT',
  app: 'Votre application',
  appSub: '{rate} écritures par seconde',
  router: 'Routeur',
  routerSub: 'pointe toujours vers le primaire',
  etcd: 'etcd',
  etcdSub: 'verrou du leader',
  wal: 'copie en direct (WAL)',
  lockExpires: 'le verrou expire dans {ttl} s',
  status: {
    unknown: 'En attente',
    starting: 'Démarrage',
    primary: 'Primaire',
    standby: 'Standby',
    catching_up: 'Rattrapage',
    waiting: 'En attente',
    demoting: 'Se retire',
    down: 'Hors service',
    isolated: 'Isolé',
  },
  roleHint: {
    primary: 'reçoit toutes les écritures',
    standby: 'copie en direct, prêt à prendre le relais',
    catching_up: 'récupère ce qu’il a manqué',
    waiting: 'pas encore de primaire à suivre',
    demoting: 'abandonne le rôle de primaire',
    starting: 'démarre PostgreSQL',
    unknown: '',
    down: '',
    isolated: 'plus de réseau',
  },
  modeDown: { crash: 'Coupure de courant', stop: 'Arrêté', isolate: 'Réseau coupé' },
  actions: { crash: 'Couper le courant', stop: 'Arrêter', isolate: 'Couper le réseau' },
  actionHint: {
    crash: 'Le tuer net, comme une panne de courant',
    stop: 'L’arrêter proprement, comme une maintenance',
    isolate: 'Le débrancher du réseau ; il continue de tourner',
  },
  bringBack: 'Le rallumer',
  latestWrite: 'Dernière écriture',
  lag: 'Retard',
  inSync: 'à jour',
  timeline: 'Timeline',
  insideView: 'Vu de l’intérieur : {role}',
  insideRole: { primary: 'encore primaire', replica: 'réplique en lecture seule' },
  confirmed: 'Écritures confirmées',
  confirmedHint: 'la base a répondu « enregistré »',
  interrupted: 'Écritures interrompues',
  interruptedHint: 'refusées ou expirées pendant la bascule ; l’appli réessaie',
  lost: 'Écritures confirmées perdues',
  lostPending: 'vérifié après chaque incident',
  lostDone: 'vérifié {when}',
  pause: 'Dernière pause des écritures',
  pauseNone: 'aucune pour l’instant',
  seconds: '{n} s',
  primaryNow: 'Primaire actuel',
  events: 'Ce qui vient de se passer',
  noEvents: 'Cassez un nœud pour voir le cluster se réparer seul.',
  writesChart: 'Écritures seconde par seconde, colorées selon le nœud qui les a enregistrées',
  failedLegend: 'interrompues',
  verify: 'Vérifier chaque écriture',
  reset: 'Remettre à zéro',
  readOnly: 'Lecture seule',
  autoRecover: 'Un nœud laissé hors service revient seul après {n} s.',
  justNow: 'à l’instant',
  agoS: 'il y a {n} s',
  phase: {
    starting: ['Démarrage du cluster', 'Trois nœuds PostgreSQL élisent leur premier primaire.'],
    healthy: [
      'Tout fonctionne normalement',
      '{leader} reçoit toutes les écritures. Les deux autres en gardent une copie en direct, à quelques millisecondes, prêts à prendre le relais.',
    ],
    waiting_lock: [
      '{node} est tombé. Les écritures sont en attente.',
      'Son verrou de leader expire dans {ttl} s. Alors seulement un standby peut prendre le relais : jamais deux primaires.',
    ],
    electing: ['Élection d’un nouveau primaire', 'Le standby qui a les données les plus récentes prend le verrou.'],
    switching: ['{node} est le nouveau primaire', 'Le routeur y redirige l’application.'],
    degraded: [
      '{node} est tombé. Le service continue sur {leader}.',
      'Les écritures reprennent. Rallumez {node} pour retrouver toute la redondance.',
    ],
    degraded_isolate: [
      '{node} est isolé. Le service continue sur {leader}.',
      'Sans accès au verrou, {node} est passé de lui-même en lecture seule : il ne peut accepter aucune écriture égarée.',
    ],
    degraded_isolate_pending: [
      '{node} est isolé. Le service continue sur {leader}.',
      'Plus rien ne peut joindre {node} : aucune écriture ne peut y arriver. Dès qu’il renonce au verrou, il passe de lui-même en lecture seule.',
    ],
    rejoining: [
      '{node} revient comme standby',
      'Il rembobine l’historique divergent, puis copie tout ce qu’il a manqué depuis {leader}.',
    ],
    recovered: [
      'Rétabli. Redondance complète.',
      'Écritures en pause pendant {outage} s. Écritures confirmées perdues : {lost}.',
    ],
  },
  ev: {
    ready: 'Cluster prêt. L’application commence à écrire.',
    leader: '{node} est le primaire.',
    failure_crash: 'Coupure de courant sur {node}.',
    failure_stop: '{node} s’arrête.',
    failure_isolate: '{node} est coupé du réseau.',
    node_down: '{node} ne répond plus.',
    writes_failing: 'Les écritures échouent : aucun primaire joignable.',
    lock_expired: 'Le verrou de leader de {node} a expiré.',
    lock_released: '{node} a rendu son verrou de leader.',
    promoted: '{node} promu primaire.',
    writes_resumed: 'Écritures reprises sur {node} après {after} s.',
    writes_moved: 'Les écritures arrivent maintenant sur {node}.',
    demoted_self: '{node} est passé de lui-même en lecture seule.',
    demoting: '{node} se retire.',
    recover: '{node} est rallumé.',
    recover_auto: '{node} rallumé automatiquement.',
    node_back: '{node} répond de nouveau.',
    rejoined: '{node} est de nouveau standby, il suit le primaire en direct.',
    verified: '{acked} écritures confirmées vérifiées : {missing} perdue(s).',
    healthy: 'Cluster de nouveau entièrement sain.',
    reset: 'Compteurs remis à zéro.',
  },
}

const ar: Dict = {
  title: 'PostgreSQL عالي التوفر',
  subtitle: 'ثلاث عقد، عقدة رئيسية واحدة، دون أي تدخل يدوي',
  live: 'مباشر',
  app: 'تطبيقك',
  appSub: '{rate} عمليات كتابة في الثانية',
  router: 'الموجّه',
  routerSub: 'يشير دائمًا إلى العقدة الرئيسية',
  etcd: 'etcd',
  etcdSub: 'قفل القيادة',
  wal: 'نسخة مباشرة (WAL)',
  lockExpires: 'ينتهي القفل خلال {ttl} ث',
  status: {
    unknown: 'انتظار',
    starting: 'بدء التشغيل',
    primary: 'رئيسية',
    standby: 'احتياطية',
    catching_up: 'تلحق بالركب',
    waiting: 'تنتظر',
    demoting: 'تتنحى',
    down: 'متوقفة',
    isolated: 'معزولة',
  },
  roleHint: {
    primary: 'تستقبل كل عمليات الكتابة',
    standby: 'نسخة مباشرة، جاهزة للتولي',
    catching_up: 'تنسخ ما فاتها',
    waiting: 'لا توجد عقدة رئيسية لتتبعها بعد',
    demoting: 'تتخلى عن الدور الرئيسي',
    starting: 'تشغيل PostgreSQL',
    unknown: '',
    down: '',
    isolated: 'بلا شبكة',
  },
  modeDown: { crash: 'انقطاع الكهرباء', stop: 'أُوقفت', isolate: 'انقطاع الشبكة' },
  actions: { crash: 'قطع الكهرباء', stop: 'إيقاف', isolate: 'قطع الشبكة' },
  actionHint: {
    crash: 'إيقاف فوري، مثل انقطاع الكهرباء',
    stop: 'إيقاف نظيف، مثل الصيانة',
    isolate: 'فصلها عن الشبكة مع بقائها تعمل',
  },
  bringBack: 'إعادة تشغيلها',
  latestWrite: 'آخر كتابة',
  lag: 'التأخر',
  inSync: 'متزامنة',
  timeline: 'الخط الزمني',
  insideView: 'من الداخل: {role}',
  insideRole: { primary: 'ما زالت رئيسية', replica: 'نسخة للقراءة فقط' },
  confirmed: 'عمليات كتابة مؤكدة',
  confirmedHint: 'أجابت قاعدة البيانات «تم الحفظ»',
  interrupted: 'عمليات كتابة متقطعة',
  interruptedHint: 'رُفضت أو انتهت مهلتها أثناء التبديل؛ التطبيق يعيد المحاولة',
  lost: 'كتابات مؤكدة مفقودة',
  lostPending: 'يُتحقق منها بعد كل حادث',
  lostDone: 'تم التحقق {when}',
  pause: 'آخر توقف للكتابة',
  pauseNone: 'لا شيء بعد',
  seconds: '{n} ث',
  primaryNow: 'العقدة الرئيسية الآن',
  events: 'ما حدث للتو',
  noEvents: 'أوقف عقدة لترى المجموعة تُصلح نفسها.',
  writesChart: 'عمليات الكتابة ثانية بثانية، ملوّنة حسب العقدة التي حفظتها',
  failedLegend: 'متقطعة',
  verify: 'تحقق من كل كتابة',
  reset: 'تصفير العدادات',
  readOnly: 'عرض فقط',
  autoRecover: 'تعود العقدة المتوقفة تلقائيًا بعد {n} ث.',
  justNow: 'الآن',
  agoS: 'منذ {n} ث',
  phase: {
    starting: ['بدء تشغيل المجموعة', 'ثلاث عقد PostgreSQL تنتخب أول عقدة رئيسية.'],
    healthy: [
      'كل شيء يعمل بشكل طبيعي',
      '{leader} تستقبل كل الكتابات. العقدتان الأخريان تحتفظان بنسخة مباشرة، متأخرة بأجزاء من الثانية، جاهزتان للتولي.',
    ],
    waiting_lock: [
      '{node} متوقفة. الكتابات في الانتظار.',
      'ينتهي قفل القيادة خلال {ttl} ث. عندها فقط يمكن لعقدة احتياطية أن تتولى: لا يمكن أبدًا وجود عقدتين رئيسيتين.',
    ],
    electing: ['انتخاب عقدة رئيسية جديدة', 'العقدة الاحتياطية التي تملك أحدث البيانات تأخذ القفل.'],
    switching: ['{node} هي العقدة الرئيسية الجديدة', 'الموجّه ينقل التطبيق إليها.'],
    degraded: [
      '{node} متوقفة. الخدمة مستمرة على {leader}.',
      'الكتابات تتدفق من جديد. أعد تشغيل {node} لاستعادة التكرار الكامل.',
    ],
    degraded_isolate: [
      '{node} معزولة. الخدمة مستمرة على {leader}.',
      'دون الوصول إلى القفل، تحولت {node} من تلقاء نفسها إلى القراءة فقط، فلا يمكنها قبول أي كتابة شاردة.',
    ],
    degraded_isolate_pending: [
      '{node} معزولة. الخدمة مستمرة على {leader}.',
      'لا شيء يستطيع الوصول إلى {node}، فلا يمكن أن تصلها أي كتابة. حين تتخلى عن القفل تتحول من تلقاء نفسها إلى القراءة فقط.',
    ],
    rejoining: [
      '{node} تعود كعقدة احتياطية',
      'تتراجع عن أي تاريخ متباعد، ثم تنسخ كل ما فاتها من {leader}.',
    ],
    recovered: ['تمت الاستعادة. التكرار الكامل عاد.', 'توقفت الكتابات {outage} ث. كتابات مؤكدة مفقودة: {lost}.'],
  },
  ev: {
    ready: 'المجموعة جاهزة. التطبيق يبدأ الكتابة.',
    leader: '{node} هي العقدة الرئيسية.',
    failure_crash: 'انقطاع الكهرباء عن {node}.',
    failure_stop: '{node} تتوقف.',
    failure_isolate: '{node} مفصولة عن الشبكة.',
    node_down: '{node} توقفت عن الاستجابة.',
    writes_failing: 'الكتابات تفشل: لا توجد عقدة رئيسية متاحة.',
    lock_expired: 'انتهى قفل القيادة لـ {node}.',
    lock_released: '{node} سلّمت قفل القيادة.',
    promoted: 'ترقية {node} إلى عقدة رئيسية.',
    writes_resumed: 'استؤنفت الكتابات على {node} بعد {after} ث.',
    writes_moved: 'الكتابات تصل الآن إلى {node}.',
    demoted_self: '{node} تحولت من تلقاء نفسها إلى القراءة فقط.',
    demoting: '{node} تتنحى.',
    recover: '{node} عادت للعمل.',
    recover_auto: 'أعيد تشغيل {node} تلقائيًا.',
    node_back: '{node} تستجيب من جديد.',
    rejoined: '{node} احتياطية من جديد، تتبع العقدة الرئيسية مباشرة.',
    verified: 'تم التحقق من {acked} كتابة مؤكدة: {missing} مفقودة.',
    healthy: 'المجموعة سليمة تمامًا من جديد.',
    reset: 'تم تصفير العدادات.',
  },
}

export const DICTS: Record<Lang, Dict> = { en, fr, ar }

export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? '—'))
}

export function numberFormat(lang: Lang) {
  const nf = new Intl.NumberFormat(lang === 'ar' ? 'ar-DZ' : lang === 'fr' ? 'fr-FR' : 'en-US', {
    maximumFractionDigits: 1,
  })
  return (n: number) => nf.format(n)
}

export function phaseText(d: Dict, phase: Phase, label: (name?: string | null) => string, fmt: (n: number) => string) {
  const key =
    phase.kind === 'degraded' && phase.mode === 'isolate'
      ? phase.demoted
        ? 'degraded_isolate'
        : 'degraded_isolate_pending'
      : phase.kind
  const [head, sub] = d.phase[key]
  const vars: Vars = {
    node: label(phase.node),
    leader: label(phase.leader),
    ttl: phase.ttl != null && phase.ttl >= 0 ? phase.ttl : '…',
    outage: phase.outage != null ? fmt(phase.outage) : '—',
    lost: phase.lost != null ? fmt(phase.lost) : '…',
  }
  return [fill(head, vars), fill(sub, vars)]
}

export function eventText(d: Dict, e: DemoEvent, label: (name?: string | null) => string, fmt: (n: number) => string) {
  let key = e.kind
  if (e.kind === 'failure') key = `failure_${e.mode}`
  if (e.kind === 'recover' && e.automatic) key = 'recover_auto'
  const template = d.ev[key]
  if (!template) return e.kind
  return fill(template, {
    node: label(e.node),
    after: e.after != null ? fmt(e.after) : '—',
    acked: e.acked != null ? fmt(e.acked) : '—',
    missing: e.missing != null ? fmt(e.missing) : '—',
  })
}
