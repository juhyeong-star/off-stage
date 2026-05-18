const MOCK_DATA = {
  currentUser: null,
  tracks: [
    // ===== 김음악 — 1982 synth =====
    {
      id: 't1',
      title: 'Midnight Drive',
      artist: '김음악',
      artistAvatar: 'https://i.pravatar.cc/150?img=11',
      cover: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', // mock royalty-free
      likes: 124,
      plays: 1050,
      createdAt: '2026-04-10T10:00:00Z',
      youtubeId: '',
      projectId: 'proj_kim_drive',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['1982년 느낌', 'synthwave', '드라이브'],
      shape: 'oval', shapeColor: '#FF9800',
      lines: ['#my music is the best', '#1982년 감성 드라이브', '#김음악의 첫 트랙 들어봐!']
    },
    {
      id: 't1d1',
      title: 'Midnight Drive (Demo 1)',
      artist: '김음악',
      artistAvatar: 'https://i.pravatar.cc/150?img=11',
      cover: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
      likes: 18,
      plays: 96,
      createdAt: '2026-03-28T22:00:00Z',
      projectId: 'proj_kim_drive',
      version: 'demo1',
      versionLabel: 'Demo 1',
      isDemo: true,
      pinned: true,
      artistNote: '드럼 조금 어색해서 빼려고 했는데 그대로 두는 게 더 좋다는 의견이 많아서 살림. 너네 어떻게 생각해? 🥁',
      tags: ['1982년 느낌', 'synthwave', '러프 데모'],
      shape: 'rect', shapeColor: '#FFB703',
      lines: ['#midnight drive', '#demo1', '#드럼 의견 줘봐'],
      stoConfig: { goalKrw: 500000, unitMin: 10000, raisedKrw: 30000, sharePercent: 8, perks: ['엔딩 크레딧 이름 게재', '✨ STO 지분 적립', '데모 발전 과정 공유'] },
      poll: {
        question: '드럼 어떻게 갈까?',
        options: [
          { key: 'keep',     label: '그대로 살림 — 그루브 좋음',         votes: 12, backerVotes: 4 },
          { key: 'remove',   label: '빼고 어쿠스틱 라인업 강조',         votes: 5,  backerVotes: 1 },
          { key: 'rework',   label: '리듬 바꿔서 정돈',                  votes: 7,  backerVotes: 2 }
        ]
      }
    },
    {
      id: 't2',
      title: 'Rainy City Blues',
      artist: '이작곡',
      artistAvatar: 'https://i.pravatar.cc/150?img=12',
      cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      likes: 85,
      plays: 600,
      createdAt: '2026-04-11T14:30:00Z',
      youtubeId: 'jfKfPfyJRdk',
      tags: ['lofi', '비 오는 날', '카페 무드'],
      shape: 'star', shapeColor: '#FF4081',
      lines: ['#비 오는 날 감성 lofi', '#카페에서 작업했어요 ☔', '#이작곡 신곡 Rainy City Blues']
    },
    {
      id: 't3',
      title: 'Neon Horizon',
      artist: '박신스',
      artistAvatar: 'https://i.pravatar.cc/150?img=13',
      cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
      likes: 342,
      plays: 5200,
      createdAt: '2026-04-12T09:15:00Z',
      youtubeId: '',
      tags: ['synthwave', 'neon', '밤'],
      shape: 'triangle', shapeColor: '#2979FF',
      lines: ['#네온 감성 synthwave', '#밤에 들으면 미침', '#박신스 Neon Horizon']
    },
    {
      id: 't4',
      title: 'Spring Awakening',
      artist: '김학생',
      artistAvatar: 'https://i.pravatar.cc/150?img=20',
      cover: 'https://images.unsplash.com/photo-1493225457124-a1a2a5f5f9af?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
      likes: 56,
      plays: 210,
      createdAt: '2026-04-13T08:00:00Z',
      youtubeId: '',
      distributeStatus: 'pending',
      tags: ['고1 작곡과', '봄', '어쿠스틱'],
      shape: 'rect', shapeColor: '#7C4DFF',
      lines: ['#고1이 작곡했어 들어봐!', '#봄에 어쿠스틱 기타로', '#음원명: Spring Awakening']
    },
    {
      id: 't5',
      title: 'Midnight Jazz',
      artist: '박밴드',
      artistAvatar: 'https://i.pravatar.cc/150?img=17',
      cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
      likes: 920,
      plays: 13000,
      createdAt: '2026-03-20T11:20:00Z',
      youtubeId: '',
      projectId: 'proj_park_jazz',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['jazz', '고3 기타과 음악', '밤'],
      shape: 'circle', shapeColor: '#76FF03',
      lines: ['#재즈 미쳤다 진짜', '#고3 기타과의 자존심', '#Midnight Jazz 🎷']
    },
    // ===== 엔젤노이즈 — dreampop =====
    {
      id: 't6',
      title: 'Bedroom Window',
      artist: '엔젤노이즈',
      artistAvatar: '/img/artists/angelnoise-profile.jpg',
      cover: '/img/covers/angelnoise-album.jpg',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
      likes: 432,
      plays: 4900,
      createdAt: '2026-04-02T19:20:00Z',
      projectId: 'proj_angel_bedroom',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['dreampop', '몽환', '밤 산책'],
      shape: 'parallelogram', shapeColor: '#7C4DFF',
      lines: ['#bedroom window', '#dreampop은 진리', '#엔젤노이즈 첫 EP 🌙']
    },
    {
      id: 't6d1',
      title: 'Bedroom Window (Demo)',
      artist: '엔젤노이즈',
      artistAvatar: '/img/artists/angelnoise-profile.jpg',
      cover: '/img/covers/angelnoise-album.jpg',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3',
      likes: 35,
      plays: 220,
      createdAt: '2026-03-25T20:00:00Z',
      projectId: 'proj_angel_bedroom',
      version: 'demo1',
      versionLabel: 'Demo 1',
      isDemo: true,
      pinned: true,
      artistNote: '아빠 카메라 들고 우연히 녹음한 보컬. 떨림이 너무 좋아서 마스터에 살짝 살림.',
      tags: ['dreampop', '러프 데모', '보컬'],
      shape: 'oval', shapeColor: '#CE93D8',
      lines: ['#bedroom window demo', '#보컬 떨림 살림', '#엔젤노이즈'],
      stoConfig: { goalKrw: 800000, unitMin: 10000, raisedKrw: 320000, sharePercent: 12, perks: ['엔딩 크레딧 이름 게재', '비공개 마스터 선공개', '✨ STO 지분 + 우선 청취권'] },
      poll: {
        question: '보컬 떨림 어디까지?',
        options: [
          { key: 'raw',     label: '날 것 그대로 — 떨림이 정체성',     votes: 28, backerVotes: 9 },
          { key: 'soft',    label: '살짝만 보정 — 들리게',             votes: 11, backerVotes: 3 },
          { key: 'clean',   label: '깔끔하게 보정 — 마스터 퀄리티',    votes: 4,  backerVotes: 1 }
        ]
      }
    },
    {
      id: 't7',
      title: '낮잠 lullaby',
      artist: '엔젤노이즈',
      artistAvatar: '/img/artists/angelnoise-profile.jpg',
      cover: '/img/covers/angelnoise-album.jpg',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
      likes: 287,
      plays: 3100,
      createdAt: '2026-03-18T14:00:00Z',
      projectId: 'proj_angel_lullaby',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['lullaby', '낮잠', '평화'],
      shape: 'circle', shapeColor: '#E1BEE7',
      lines: ['#낮잠 라이트', '#엔젤노이즈 차분 모드', '#졸음방지 X 졸음유도 O']
    },
    // ===== 루시드 베어 — chillhop / lofi =====
    {
      id: 't8',
      title: '하굣길 라떼',
      artist: '루시드 베어',
      artistAvatar: 'https://i.pravatar.cc/300?img=33',
      cover: 'https://images.unsplash.com/photo-1493225457124-a1a2a5f5f9af?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
      likes: 712,
      plays: 12300,
      createdAt: '2026-04-04T17:00:00Z',
      projectId: 'proj_lucid_latte',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['lofi', '하굣길', '카페 무드'],
      shape: 'hexagon', shapeColor: '#4ECDC4',
      lines: ['#하굣길 BGM', '#루시드 베어 시그니처', '#카페에서 작업하기 좋음']
    },
    {
      id: 't8d1',
      title: '하굣길 라떼 (Demo)',
      artist: '루시드 베어',
      artistAvatar: 'https://i.pravatar.cc/300?img=33',
      cover: 'https://images.unsplash.com/photo-1493225457124-a1a2a5f5f9af?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3',
      likes: 22,
      plays: 130,
      createdAt: '2026-03-15T16:30:00Z',
      projectId: 'proj_lucid_latte',
      version: 'demo1',
      versionLabel: 'Demo 1',
      isDemo: true,
      pinned: true,
      artistNote: '비트 BPM 두 번 바꿔봤는데 어떤 게 좋아? 너네가 정해줘 🙏',
      tags: ['lofi', '데모', 'bpm 의견'],
      shape: 'rect', shapeColor: '#80DEEA',
      lines: ['#하굣길 라떼 demo', '#bpm 의견 줘', '#루시드 베어'],
      stoConfig: { goalKrw: 1000000, unitMin: 30000, raisedKrw: 720000, sharePercent: 15, perks: ['엔딩 크레딧 이름 게재', '비공개 마스터 선공개', '✨ STO 지분 + 우선 청취권'] },
      poll: {
        question: 'BPM 어떻게?',
        options: [
          { key: 'slow',    label: 'BPM 80 — 졸린 카페 무드',            votes: 19, backerVotes: 6 },
          { key: 'med',     label: 'BPM 95 — 적당한 그루브',              votes: 24, backerVotes: 8 },
          { key: 'fast',    label: 'BPM 110 — 텐션 있게',                  votes: 8,  backerVotes: 2 }
        ]
      }
    },
    {
      id: 't9',
      title: 'Cassette Tape',
      artist: '루시드 베어',
      artistAvatar: 'https://i.pravatar.cc/300?img=33',
      cover: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
      likes: 538,
      plays: 8900,
      createdAt: '2026-03-10T10:00:00Z',
      projectId: 'proj_lucid_cassette',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['lofi', '90s', '카세트'],
      shape: 'rect', shapeColor: '#69F0AE',
      lines: ['#카세트 테이프', '#90년대 감성 lofi', '#루시드 베어 b-side']
    },
    // ===== 오프스테이지 — indie rock collective =====
    {
      id: 't10',
      title: '무대 뒤에서',
      artist: '오프스테이지',
      artistAvatar: 'https://i.pravatar.cc/300?img=68',
      cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3',
      likes: 1820,
      plays: 78000,
      createdAt: '2026-02-14T20:00:00Z',
      projectId: 'proj_offstage_behind',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['indie rock', '록', '대형'],
      shape: 'star', shapeColor: '#E63946',
      lines: ['#오프스테이지 대표곡', '#무대 뒤에서', '#록 미쳤다 🔥']
    },
    {
      id: 't11',
      title: '폭우',
      artist: '오프스테이지',
      artistAvatar: 'https://i.pravatar.cc/300?img=68',
      cover: 'https://images.unsplash.com/photo-1518972559570-7cc1309f3229?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3',
      likes: 942,
      plays: 32000,
      createdAt: '2026-03-22T18:00:00Z',
      projectId: 'proj_offstage_rain',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['indie rock', '비', '폭주'],
      shape: 'triangle', shapeColor: '#1D3557',
      lines: ['#폭우', '#락 폭주', '#오프스테이지 새 싱글']
    },
    {
      id: 't11d1',
      title: '폭우 (Demo)',
      artist: '오프스테이지',
      artistAvatar: 'https://i.pravatar.cc/300?img=68',
      cover: 'https://images.unsplash.com/photo-1518972559570-7cc1309f3229?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3',
      likes: 64,
      plays: 480,
      createdAt: '2026-03-05T22:00:00Z',
      projectId: 'proj_offstage_rain',
      version: 'demo1',
      versionLabel: 'Demo 1',
      isDemo: true,
      pinned: true,
      artistNote: '합주실 201호 폭우 직전 녹음. 후렴 코러스 멤버 더 추가할지 고민 중. 의견 줘!',
      tags: ['indie rock', '러프', '코러스 의견'],
      shape: 'parallelogram', shapeColor: '#FF8A65',
      lines: ['#폭우 demo', '#코러스 추가 의견', '#합주실 201'],
      stoConfig: { goalKrw: 2000000, unitMin: 50000, raisedKrw: 1450000, sharePercent: 20, perks: ['엔딩 크레딧 이름 게재', '비공개 마스터 선공개', '오프라인 공감홀 초대권 🎤'] },
      poll: {
        question: '코러스 멤버 인원은?',
        options: [
          { key: 'four',    label: '4명 그대로 — 정돈된 합',             votes: 16, backerVotes: 5 },
          { key: 'six',     label: '6명 추가 — 더 두꺼운 후렴',          votes: 38, backerVotes: 14 },
          { key: 'big',     label: '8명+ — 합창단 느낌으로 폭주',        votes: 12, backerVotes: 3 }
        ]
      }
    },

    // ============================================================
    // 🐑 Peek — bedroom pop / indie pop (REAL ARTIST)
    // 데모1 (Beat only) → 데모2 (+ Vocal) → MASTER (Full)
    // ============================================================
    {
      id: 'tp1',
      title: 'kiss kiss kiss type',
      artist: 'Peek',
      artistAvatar: '/img/artists/peek.png',
      cover: '/img/artists/peek.png',
      audioUrl: '/audio/peek-kiss-kiss-kiss-type.mp3',
      likes: 247,
      plays: 1820,
      createdAt: '2026-04-28T19:00:00Z',
      projectId: 'proj_peek_kkkt',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['bedroom pop', 'indie pop', '데뷔곡', '양 인형'],
      shape: 'circle', shapeColor: '#A8E063',
      lines: ['#첫 데뷔 단독 곡', '#양 인형이랑 같이 만든', '#Peek kiss kiss kiss type 🐑'],
      artistNote: 'kiss kiss kiss type 만들 때 양 인형이 옆에 있었어요. 처음 올리는 곡이라 부끄럽지만 들어주세요 🐑',
      stoConfig: { goalKrw: 800000, unitMin: 10000, raisedKrw: 620000, sharePercent: 12, perks: ['엔딩 크레딧 이름 게재', 'beat/vocal stems 다운로드', '다음 EP 사전 청취권'] }
    },
    {
      id: 'tp1d1',
      title: 'kiss kiss kiss type (Beat)',
      artist: 'Peek',
      artistAvatar: '/img/artists/peek.png',
      cover: '/img/artists/peek.png',
      audioUrl: '/audio/peek-kiss-kiss-kiss-type-beat.mp3',
      likes: 38,
      plays: 210,
      createdAt: '2026-04-15T22:00:00Z',
      projectId: 'proj_peek_kkkt',
      version: 'demo1',
      versionLabel: 'Demo 1 — Beat only',
      isDemo: true,
      artistNote: '비트만 먼저. 보컬 어떻게 얹을까 고민하면서. 의견 들려줘 🥁',
      tags: ['bedroom pop', '러프 데모', 'beat only'],
      shape: 'circle', shapeColor: '#80E27E',
      lines: ['#kiss type beat demo', '#보컬 의견 환영', '#Peek 시작점'],
      stoConfig: { goalKrw: 300000, unitMin: 5000, raisedKrw: 180000, sharePercent: 8, perks: ['엔딩 크레딧 이름 게재', '제작 과정 공유'] }
    },
    {
      id: 'tp1d2',
      title: 'kiss kiss kiss type (+ Vocal)',
      artist: 'Peek',
      artistAvatar: '/img/artists/peek.png',
      cover: '/img/artists/peek.png',
      audioUrl: '/audio/peek-kiss-kiss-kiss-type-vocal.mp3',
      likes: 92,
      plays: 540,
      createdAt: '2026-04-22T20:00:00Z',
      projectId: 'proj_peek_kkkt',
      version: 'demo2',
      versionLabel: 'Demo 2 — + Vocal',
      isDemo: true,
      artistNote: '보컬 처음으로 얹어봤어요. 부르면서 약간 떨렸는데 — 그 떨림 살릴지 깎을지 의견 들려주세요 🎤',
      tags: ['bedroom pop', '보컬 추가', '데모 evolution'],
      shape: 'circle', shapeColor: '#66BB6A',
      lines: ['#보컬 처음 얹음', '#떨림 살릴까 말까', '#Peek demo2'],
      stoConfig: { goalKrw: 500000, unitMin: 8000, raisedKrw: 380000, sharePercent: 10, perks: ['엔딩 크레딧 이름 게재', '비공개 vocal stem 다운로드', '데모 발전 과정 공유'] }
    },

    // ============================================================
    // 🏢 SM Entertainment — 가상 메이저 레이블 (Stage 4 별빛)
    // ⚠️ SAMPLE PLACEHOLDER: 표지 사진은 IR 데모 참고용 K-pop 그룹 이미지.
    //    실재 그룹(Red Velvet / RIIZE 등)과 무관, 정식 출시 전 교체 필수.
    // ============================================================
    {
      id: 'tsm1',
      title: 'Velvet Garden',
      artist: 'SM Entertainment',
      artistAvatar: '/img/artists/sm-profile.jpg',
      cover: '/img/covers/sm-velvet.webp',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
      likes: 18420,
      plays: 1240000,
      createdAt: '2025-11-22T15:00:00Z',
      projectId: 'proj_sm_velvet',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['K-pop', 'dance pop', 'VELVET', '컴백', '메이저'],
      shape: 'star', shapeColor: '#722F37',
      lines: ['#VELVET 정규 2집 타이틀', '#글로벌 1.2억 스트리밍', '#로열티 정산 후원자 분배 💎'],
      artistNote: 'VELVET 정규 2집 「Velvet Garden」 — 멤버 작사 참여 50%. 후원자 분들의 사전 청취 피드백 반영했습니다.',
      stoConfig: { goalKrw: 50000000, unitMin: 100000, raisedKrw: 42000000, sharePercent: 5, perks: ['엔딩 크레딧 이름 게재', '미공개 셀카 패키지', '쇼케이스 초대권', '글로벌 로열티 분배'] }
    },
    {
      id: 'tsm2',
      title: 'Cosmic Stage',
      artist: 'SM Entertainment',
      artistAvatar: '/img/artists/sm-profile.jpg',
      cover: '/img/covers/sm-aether.jpg',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
      likes: 23800,
      plays: 1830000,
      createdAt: '2026-02-14T18:00:00Z',
      projectId: 'proj_sm_aether',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['K-pop', 'dance', 'AETHER', '6인 보이그룹', '데뷔'],
      shape: 'diamond', shapeColor: '#1A237E',
      lines: ['#AETHER 데뷔 EP 타이틀', '#멤버 6명 우주적 컨셉', '#후원자 사전 청취 30명 한정'],
      artistNote: 'AETHER 데뷔 EP 「Cosmic Stage」 — 멤버 6명 전원 작곡 참여. 후원자 분들 응원 덕분에 무사히 컴백.',
      stoConfig: { goalKrw: 80000000, unitMin: 100000, raisedKrw: 80000000, sharePercent: 6, perks: ['엔딩 크레딧 이름 게재', '데뷔 쇼케이스 초대권', '미공개 비하인드 영상', '글로벌 로열티 분배'] }
    },
    {
      id: 'tsm3',
      title: 'Ribbon',
      artist: 'SM Entertainment',
      artistAvatar: '/img/artists/sm-profile.jpg',
      cover: '/img/covers/sm-lilies.jpg',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
      likes: 31200,
      plays: 2480000,
      createdAt: '2026-03-15T12:00:00Z',
      projectId: 'proj_sm_lilies',
      version: 'final',
      versionLabel: 'Final',
      isDemo: false,
      tags: ['K-pop', 'dance pop', 'LILIES', '8인 걸그룹', '컴백'],
      shape: 'oval', shapeColor: '#E91E63',
      lines: ['#LILIES 미니 3집 타이틀', '#청량 발레코어 컨셉', '#글로벌 2.5억 스트리밍'],
      artistNote: 'LILIES 미니 3집 「Ribbon」 — 청량 컨셉 + 발레코어. 안무 멤버 8명 1:1 챌린지 함께해주신 후원자분들 감사 🎀',
      stoConfig: { goalKrw: 100000000, unitMin: 100000, raisedKrw: 98000000, sharePercent: 6, perks: ['엔딩 크레딧 이름 게재', '쇼케이스 초대권', '글로벌 로열티 분배', '안무 챌린지 우승자 SNS 게재'] }
    },
    {
      id: 'tsm4',
      title: 'Eclipse',
      artist: 'SM Entertainment',
      artistAvatar: '/img/artists/sm-profile.jpg',
      cover: '/img/covers/sm-aether.jpg',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3',
      likes: 0,
      plays: 0,
      createdAt: '2026-05-08T22:00:00Z',
      projectId: 'proj_sm_aether',
      version: 'demo1',
      versionLabel: 'Demo 1 — UNRELEASED',
      isDemo: true,
      pinned: true,
      artistNote: 'AETHER 차기 타이틀곡 비공개 데모. 후원자 30명 한정으로만 공개합니다 — 메이저 그룹이 데모를 사전 공개하는 첫 사례. 의견 들려주세요.',
      tags: ['K-pop', '비공개 데모', 'AETHER', '후원자 한정', '한정 30명'],
      shape: 'diamond', shapeColor: '#311B92',
      lines: ['#AETHER 차기 타이틀 데모', '#후원자 30명 한정 공개', '#컴백 D-21'],
      stoConfig: { goalKrw: 30000000, unitMin: 1000000, raisedKrw: 30000000, sharePercent: 8, perks: ['🌌 데뷔 후 첫 데모 청취권 (30명 한정)', '엔딩 크레딧 이름 게재', '컴백 쇼케이스 VIP 좌석', '미공개 안무 영상', '글로벌 로열티 분배'] }
    }
  ],
  reservations: [
    { room: '201', date: '2026-04-14', time: '14:00', by: '이작곡' },
    { room: '201', date: '2026-04-14', time: '16:00', by: '박신스' },
    { room: '202', date: '2026-04-15', time: '18:00', by: '락밴드A' },
    { room: '203', date: '2026-04-16', time: '20:00', by: '재즈동아리' }
  ],
  events: [
    {
      id: 'e1',
      title: '제1회 인디 뮤직 페스티벌',
      description: '업로드 곡 100곡 돌파 기념 자체 공연!',
      date: '2026-05-20',
      banner: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&q=80&w=1000'
    }
  ],
  playlists: [
    { id: 'p1', title: '함께 만든 컬렉션 💎', cover: '/img/artists/peek.png', trackIds: ['tp1', 'tsm1', 'tsm3', 't_angel1'] },
    { id: 'p2', title: '감성 새벽 🌙', cover: '/img/covers/angelnoise-album.jpg', trackIds: ['tp1', 't_angel3', 't_lucid1'] },
    { id: 'p3', title: 'K-POP 별빛 ⭐', cover: '/img/covers/sm-lilies.jpg', trackIds: ['tsm1', 'tsm2', 'tsm3'] }
  ],
  albums: [
    { id: 'a1', title: 'The First Year', artist: '이작곡', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=500', year: 2025 },
    { id: 'a2', title: 'Midnight EP', artist: '박신스', cover: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=500', year: 2026 }
  ],
  stations: [
    { id: 's1', title: '인디 팝 스테이션', cover: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500', type: 'Radio' },
    { id: 's2', title: '비 오는 날 무드', cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=500', type: 'Mix' }
  ],
  notes: [
    { id: 'n1', author: '김음악', text: '오늘 새벽에 만든 비트 들어봐줘 ✨\n#1982년 느낌 진짜 잘 뽑힘', color: 'yellow', rotation: -2, createdAt: '2026-04-13T22:00:00Z' },
    { id: 'n2', author: '이작곡', text: '비 오는 날 카페에서\n작업하기 딱 좋은 곡 추천해줘 ☔', color: 'blue', rotation: 1.5, createdAt: '2026-04-12T15:30:00Z' },
    { id: 'n3', author: '박신스', text: 'synthwave 좋아하는 친구들 모여라!\n같이 합주실 잡고 싶어 🎹', color: 'pink', rotation: -1, createdAt: '2026-04-13T18:00:00Z' },
    { id: 'n4', author: '김학생', text: '고2 기타과 단톡방 어디서 구해?\n급해 ㅠㅠ', color: 'green', rotation: 2.5, createdAt: '2026-04-14T09:15:00Z' },
    { id: 'n5', author: '박밴드', text: '재즈 잼세션 같이 할 사람 ?\n금요일 6시 202호 🎷', color: 'orange', rotation: -1.8, createdAt: '2026-04-14T11:00:00Z' },
    { id: 'n6', author: '이작곡', text: '내 새 곡 "Sunset Groove"\n드라이브하면서 들어주세용 🌅', color: 'purple', rotation: 1.2, createdAt: '2026-04-13T20:00:00Z' },
    // === 청취자 응원 메시지 (mock listeners) ===
    { id: 'n7', author: '청취자_민지', text: '엔젤노이즈 「낮잠 lullaby」\n진짜 매일 낮잠 잘 때 듣고 있어요 🌷', color: 'pink', rotation: 1.8, createdAt: '2026-04-15T13:20:00Z' },
    { id: 'n8', author: '청취자_도윤', text: '루시드 베어 카세트 테이프\n90년대 감성 미쳤음... 데뷔 EP 언제 나와?', color: 'yellow', rotation: -2.2, createdAt: '2026-04-15T18:00:00Z' },
    { id: 'n9', author: '청취자_서연', text: '오프스테이지 「폭우」\n첫 라이브 보고 진짜 울었어요 ㅠㅠ\n다음 공연 꼭 갈게요', color: 'blue', rotation: -0.8, createdAt: '2026-04-16T20:30:00Z' },
    { id: 'n10', author: '엔젤노이즈', text: '「Bedroom Window」 demo에 보컬 떨림 그대로 살릴까 싶어\n어떻게 생각해?', color: 'purple', rotation: 2.1, createdAt: '2026-03-26T11:00:00Z' },
    { id: 'n11', author: '청취자_지호', text: '함께만들기 5만원 했어요\n첫 STO 후원! 완성되면 알려주세요 💎', color: 'green', rotation: 1.4, createdAt: '2026-04-16T15:00:00Z' },
    { id: 'n12', author: '루시드 베어', text: '하굣길 라떼 demo BPM 의견 너무 많이 와서\n멤버랑 다 보고 결정할게 — 고마워!', color: 'orange', rotation: -1.5, createdAt: '2026-03-17T17:00:00Z' },
    { id: 'n13', author: '청취자_은서', text: '엔젤노이즈 카드 별빛 됐어요 ⭐\n몇 달째 함께 만들고 있는 보람!', color: 'pink', rotation: -2.3, createdAt: '2026-04-17T22:10:00Z' },
    { id: 'n14', author: '오프스테이지', text: '폭우 마스터 작업 마침\n합주실 201호 6/3 공연 — STO 별빛 등급 분 초대권 드려요', color: 'blue', rotation: 1.0, createdAt: '2026-04-08T10:00:00Z' },
    { id: 'n15', author: '청취자_하늘', text: '루시드 베어\n"Cassette Tape" 진짜 매일 들어요\n공연 한 번이라도 했으면 ❤️', color: 'yellow', rotation: 2.4, createdAt: '2026-04-17T08:00:00Z' },
    { id: 'n16', author: '청취자_재희', text: '오프스테이지 「무대 뒤에서」\n학교 마치고 듣고 가요\n매일이 단편영화 같아요', color: 'green', rotation: -1.2, createdAt: '2026-04-16T19:30:00Z' },
    { id: 'n17', author: '엔젤노이즈', text: '오늘 작업실 늦게까지 있을 거야\n낮잠 lullaby 마스터링 방향 추천해줄 사람 환영', color: 'purple', rotation: 0.5, createdAt: '2026-04-15T23:00:00Z' },
    { id: 'n18', author: '청취자_가람', text: '함께만들기 30만원 갔어요!\n루시드 베어 다음 EP 너무 기대돼요 🎧', color: 'orange', rotation: -0.7, createdAt: '2026-04-17T12:30:00Z' },
    { id: 'n19', author: '청취자_시우', text: '엔젤노이즈 demo 보컬 떨림 그대로!!\n그 떨림이 곡의 정체성이에요', color: 'pink', rotation: 1.7, createdAt: '2026-03-28T14:00:00Z' },
    { id: 'n20', author: '오프스테이지', text: '폭우 demo 코러스\n4명 → 6명 추가하기로 결정.\n의견 다 읽었어. 고마워. 🙏', color: 'blue', rotation: -2.0, createdAt: '2026-03-08T20:00:00Z' },
    // === Peek (real artist debut) ===
    { id: 'n21', author: 'Peek', text: '처음 올리는 곡이에요\n부끄럽지만 들어주세요 🐑\n양 인형이 옆에 있었어요', color: 'green', rotation: -1.4, createdAt: '2026-04-28T19:30:00Z' },
    { id: 'n22', author: '청취자_라일락', text: 'Peek 「kiss kiss kiss type」\n첫 데뷔부터 너무 안정적임\n양 인형 보고 결제 누름 🥲', color: 'pink', rotation: 1.8, createdAt: '2026-04-29T10:00:00Z' },
    // === SM Entertainment (sample) ===
    { id: 'n23', author: 'SM Entertainment', text: 'AETHER 차기 타이틀 「Eclipse」\n비공개 데모 한정 30명 후원자 공개\n메이저 그룹 첫 데모 사전 공개 🌌', color: 'purple', rotation: 0.8, createdAt: '2026-05-08T22:30:00Z' },
    { id: 'n24', author: '청취자_새벽음악', text: 'SM 페이지에서 데모를 들을 수 있다고?\n시대가 바뀌었네... 후원 빨리 마감되면 어쩌지', color: 'yellow', rotation: -1.6, createdAt: '2026-05-09T08:00:00Z' },
    { id: 'n25', author: '청취자_엔젤', text: 'LILIES 「Ribbon」 안무 챌린지 1등\n쇼케이스 초대권 받았어요!! 💎\n진짜 STO 후원의 메리트', color: 'blue', rotation: 1.2, createdAt: '2026-04-10T15:00:00Z' },

    // === SM Entertainment — 메이저 레이블 voice (IR/팬 공지 톤) ===
    { id: 'n26', author: 'SM Entertainment', text: 'VELVET 글로벌 투어 다음 주 공식 발표\nNYC · LA · 도쿄 · 파리 · 런던 단독공연\n선예매: STO 별빛 등급 후원자 우선권 🎫', color: 'pink', rotation: -1.4, createdAt: '2026-05-10T11:00:00Z' },
    { id: 'n27', author: 'SM Entertainment', text: 'AETHER 「Cosmic Stage」 글로벌 누적 1.8억 스트리밍\n데뷔 6개월 K-pop 신기록\n로열티 분배 — 다음 분기 정산 예정 💎', color: 'blue', rotation: 1.6, createdAt: '2026-05-09T18:00:00Z' },
    { id: 'n28', author: 'SM Entertainment', text: 'LILIES 「Ribbon」 안무 챌린지\n글로벌 K-pop 챌린지 차트 1위 진입\n상위 후원자 100명 쇼케이스 백스테이지 초대 ✨', color: 'green', rotation: -0.9, createdAt: '2026-05-07T15:30:00Z' },
    { id: 'n29', author: 'SM Entertainment', text: '新 보이그룹 9월 데뷔 확정\n멤버 7인, 평균 연령 18.5세\nSTO 사전 후원자 한정 프리데뷔 쇼케이스 우선 초대 🎤', color: 'orange', rotation: 2.2, createdAt: '2026-05-06T20:00:00Z' },
    { id: 'n30', author: 'SM Entertainment', text: 'VELVET 정규 3집 작업 시작\n멤버 작사·작곡 참여율 70% 목표\n진행 과정·미공개 컷 후원자 분께만 공유 📀', color: 'purple', rotation: -2.1, createdAt: '2026-05-04T13:00:00Z' },
    { id: 'n31', author: 'SM Entertainment', text: '글로벌 콜라보 발표 — 다음 주 정식 공개\n美 그래미 노미네이션 아티스트 공동 작업\n자세한 건 후원자 페이지에서 먼저 🌍', color: 'yellow', rotation: 1.1, createdAt: '2026-05-03T10:00:00Z' },
    { id: 'n32', author: 'SM Entertainment', text: 'AETHER 일본 도쿄돔 단독공연 매진\n10만석 9분 컷\n팬분들 진심으로 감사합니다 🇯🇵🙏', color: 'pink', rotation: -1.7, createdAt: '2026-05-01T09:00:00Z' },

    // === Peek — bedroom pop, 프랑스어로 말하는 평소의 순간들 ===
    { id: 'n33', author: 'Peek', text: "J'ai trouvé une mélodie ce matin ☁️\nUn petit air au piano dans ma chambre\nPeut-être pour le prochain EP 🎹", color: 'blue', rotation: -1.3, createdAt: '2026-05-11T07:30:00Z' },
    { id: 'n34', author: 'Peek', text: "Mon mouton est devenu mon co-producteur 🐑\nIl écoute toutes mes démos\nIl ne dit jamais non — coach parfait", color: 'green', rotation: 1.9, createdAt: '2026-05-10T22:00:00Z' },
    { id: 'n35', author: 'Peek', text: "Café · cahier · guitare\nLa recette du dimanche après-midi ☕\nMerci d'être là avec moi 🤍", color: 'orange', rotation: -2.0, createdAt: '2026-05-10T15:00:00Z' },
    { id: 'n36', author: 'Peek', text: "Je viens d'enregistrer dans ma chambre\nLes voisins ont fermé la fenêtre 🪟\nDésolée — mais merci pour l'inspiration", color: 'yellow', rotation: 0.8, createdAt: '2026-05-09T23:30:00Z' },
    { id: 'n37', author: 'Peek', text: "Petit cadeau ce week-end :\nune démo cachée pour les backers 💌\nMerci d'avoir cru en moi dès le début", color: 'pink', rotation: -1.5, createdAt: '2026-05-08T18:00:00Z' },
    { id: 'n38', author: 'Peek', text: "Tomber amoureuse de ma propre voix 🌷\nC'est mon objectif cette semaine\nVotre soutien me donne du courage", color: 'purple', rotation: 2.3, createdAt: '2026-05-07T11:00:00Z' },
    { id: 'n39', author: 'Peek', text: "Première fois que je chante en français 🇫🇷\nUn peu timide mais\nje veux essayer pour vous ✨", color: 'blue', rotation: -0.6, createdAt: '2026-05-05T20:30:00Z' },

    // === 글로벌 IR 데모용 — 외국인 사용 가정, 한글·영어·일어·프랑스어 mix + 재미난 톤 ===
    // 오프스테이지: 메이저 레이블 도발 + J-POP rebrand 농담
    { id: 'n40', author: '오프스테이지', text: '#내가 민희진 보다 잘함\n우리 직캠 한 번 보면 알아 👀\n— 오프스테이지 feat. 자신감 폭발', color: 'pink', rotation: -2.3, createdAt: '2026-05-11T15:00:00Z' },
    { id: 'n41', author: '오프스테이지', text: '#뉴진스 내가 챙긴다\n다음 컴백은 우리 손에 맡겨\nproduced by 오프스테이지 🔥', color: 'blue', rotation: 1.8, createdAt: '2026-05-11T11:30:00Z' },
    { id: 'n42', author: '오프스테이지', text: "#hey we are new J-POP Rock Band 🌸\n#but we don't speak japaness\n#but lyric is japaness — それでもいい?", color: 'yellow', rotation: -0.7, createdAt: '2026-05-10T19:00:00Z' },

    // 김학생: 자뻑 톤
    { id: 'n43', author: '김학생', text: '#내음악들어봐 진짜로\n한 번만 들으면 멈출 수 없음\nspoiler: 고2 작곡과 미친 천재 😎', color: 'green', rotation: -1.1, createdAt: '2026-05-09T17:00:00Z' },

    // 박신스: 영어 어필
    { id: 'n44', author: '박신스', text: 'synthwave from Seoul → world 🌍\nplease give me a chance\nmy music doesn\'t need translation', color: 'purple', rotation: 0.9, createdAt: '2026-05-08T22:00:00Z' },

    // Peek: 다국어 데뷔 인사
    { id: 'n45', author: 'Peek', text: 'Hello! Bonjour! 안녕! こんにちは 🌷\nfirst time singing in 4 languages\n양 인형이 자랑스러워해 🐑', color: 'pink', rotation: -1.8, createdAt: '2026-05-11T09:00:00Z' },

    // === 글로벌 리스너 — NYC / Tokyo / Madrid / Berlin ===
    { id: 'n46', author: 'listener_aria', text: 'just found this app from NYC 🗽\nthe shapes universe is unreal\nAngel Noise on loop all week', color: 'green', rotation: 1.4, createdAt: '2026-05-11T03:00:00Z' },
    { id: 'n47', author: 'リスナー_さくら', text: '東京から愛を込めて 🗼\nPeekのフランス語、最高に可愛い\n次の曲も楽しみ', color: 'pink', rotation: -1.6, createdAt: '2026-05-10T20:30:00Z' },
    { id: 'n48', author: 'listener_marcus', text: 'STO = Story Token Offering 💎\nfinally a music platform that pays artists\n#K-indie #global #futureofmusic', color: 'purple', rotation: 2.1, createdAt: '2026-05-10T08:00:00Z' },
    { id: 'n49', author: 'リスナー_ハル', text: '深夜2時、ヘッドホンで聴く\nそれがangelnoiseの正しい使い方 🌙\n眠れない夜のための音楽', color: 'blue', rotation: -2.0, createdAt: '2026-05-09T02:15:00Z' },
    { id: 'n50', author: 'listener_diego', text: 'from Madrid 🇪🇸\n루시드 베어 = perfect for siesta\nstreaming chart Spain 1위 도전 중', color: 'orange', rotation: 1.3, createdAt: '2026-05-08T14:00:00Z' },
    { id: 'n51', author: 'listener_lena', text: 'Berlin techno scene meets K-indie 🇩🇪\nthis app is the future\nbuying STO shares of every demo', color: 'green', rotation: -0.9, createdAt: '2026-05-07T22:00:00Z' }
  ],
  following: [
    { id: 'u1', name: '김음악', avatar: 'https://i.pravatar.cc/150?img=11', followers: 230, sns: { instagram: 'https://instagram.com/kimmusic', youtube: 'https://youtube.com/@kimmusic', tiktok: '', twitter: '' } },
    { id: 'u2', name: '이작곡', avatar: 'https://i.pravatar.cc/150?img=12', followers: 45, sns: { instagram: 'https://instagram.com/leesong', youtube: '', tiktok: 'https://tiktok.com/@leesong', twitter: '' } },
    { id: 'u3', name: '박신스', avatar: 'https://i.pravatar.cc/150?img=13', followers: 812, sns: { instagram: 'https://instagram.com/parksynth', youtube: 'https://youtube.com/@parksynth', tiktok: 'https://tiktok.com/@parksynth', twitter: 'https://x.com/parksynth' } },
    { id: 'u_angel', name: '엔젤노이즈', avatar: '/img/artists/angelnoise-profile.jpg', followers: 1820, role: 'artist', sns: { instagram: 'https://instagram.com/angelnoise', youtube: 'https://youtube.com/@angelnoise', tiktok: '', twitter: '' } },
    { id: 'u_lucid', name: '루시드 베어', avatar: 'https://i.pravatar.cc/300?img=33', followers: 4400, role: 'artist', sns: { instagram: 'https://instagram.com/lucidbear', youtube: 'https://youtube.com/@lucidbear', tiktok: 'https://tiktok.com/@lucidbear', twitter: '' } },
    { id: 'u_off',   name: '오프스테이지', avatar: 'https://i.pravatar.cc/300?img=68', followers: 12400, role: 'artist', sns: { instagram: 'https://instagram.com/offstage', youtube: 'https://youtube.com/@offstage', tiktok: '', twitter: 'https://x.com/offstage' } },
    // === REAL: Peek (bedroom pop, debut 2026.04) ===
    { id: 'u_peek',  name: 'Peek',       avatar: '/img/artists/peek.png', followers: 290, role: 'artist', sns: { instagram: 'https://instagram.com/peek', youtube: '', tiktok: '', twitter: '' } },
    // === SAMPLE: SM Entertainment (가상 메이저 레이블, placeholder 사진) ===
    { id: 'u_sm',    name: 'SM Entertainment', avatar: '/img/artists/sm-profile.jpg', followers: 2480000, role: 'artist', sns: { instagram: 'https://instagram.com/sment', youtube: 'https://youtube.com/@sment', tiktok: '', twitter: '' } }
  ],
  // Curated artists for onboarding picker
  onboardingArtists: [
    { id: 'mock_peek',    name: 'Peek',          avatar: '/img/artists/peek.png', tagline: 'bedroom pop · 양 인형 🐑',    streamCount: 1820,  spoBackers: 32 },
    { id: 'mock_angel',   name: '엔젤노이즈',     avatar: '/img/artists/angelnoise-profile.jpg', tagline: 'alt rock · 합주실 노이즈 🎸',         streamCount: 7900,  spoBackers: 18 },
    { id: 'mock_sm',      name: 'SM Entertainment', avatar: '/img/artists/sm-profile.jpg', tagline: 'K-pop label · 메이저 별빛 ⭐',  streamCount: 2480000, spoBackers: 1200 },
    { id: 'mock_lucid',   name: '루시드 베어',     avatar: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&q=80&w=400', tagline: 'lofi · 카페 무드 ☕',        streamCount: 21300, spoBackers: 28 },
    { id: 'mock_offstage',name: '오프스테이지',   avatar: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=400', tagline: 'indie rock · 록 폭주 🔥',    streamCount: 110000,spoBackers: 95 },
    { id: 'mock_park',    name: '박신스',         avatar: 'https://i.pravatar.cc/300?img=13', tagline: 'synthwave · 네온 밤 🌃',          streamCount: 5200,  spoBackers: 8 }
  ]
};

// LocalStorage Persistence Layer
const DATA_VERSION = '22';
if (localStorage.getItem('offstage_data_version') !== DATA_VERSION) {
  localStorage.removeItem('offstage_data');
  localStorage.setItem('offstage_data_version', DATA_VERSION);
}
let currentData = localStorage.getItem('offstage_data');
if (!currentData) {
  // Seed initial data, then fall through to migration so demos/enrichment always run
  localStorage.setItem('offstage_data', JSON.stringify(MOCK_DATA));
  currentData = localStorage.getItem('offstage_data');
}
{
  // Auto-migrate new mock properties
  let parsed = JSON.parse(currentData);
  let changed = false;
  ['playlists', 'albums', 'stations', 'following'].forEach(key => {
    if (!parsed[key]) {
      parsed[key] = MOCK_DATA[key];
      changed = true;
    }
  });

  // Migrate old reservations missing room ID
  if (parsed.reservations && parsed.reservations.length > 0) {
    parsed.reservations.forEach(r => {
      if (!r.room) {
        r.room = '201';
        changed = true;
      }
    });
  }

  // Inject track list dummy data for demo purposes
  const t2 = parsed.tracks.find(t => t.id === 't2');
  if (t2 && !t2.description) {
    t2.description = '비 오는 날 카페 창가에서 영감을 받아 작곡한 로파이 음악입니다.\n\n중간에 들어가는 빗소리와 일렉 피아노의 조화가 포인트입니다. 편하게 들어주세요! ☔';
    changed = true;
  }
  if (!parsed.tracks.find(t => t.id === 't6')) {
     parsed.tracks.push({
      id: 't6',
      title: 'Sunset Groove',
      description: '저녁 노을을 보며 해안도로를 달리는 기분으로 작업했습니다. 노을 지는 해변가에서 들어주세요!',
      artist: '이작곡',
      artistAvatar: 'https://i.pravatar.cc/150?img=12',
      cover: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
      likes: 128,
      plays: 870,
      createdAt: '2026-04-12T18:00:00Z',
      youtubeId: '',
      tags: ['funky', '드라이브', '노을'],
      shape: 'parallelogram', shapeColor: '#FFD600',
      lines: ['#funky 하면 이 곡이지', '#드라이브 BGM 추천', '#이작곡 Sunset Groove 🌅']
     });
     changed = true;
  }

  // Migrate tracks: ensure tags array exists
  if (parsed.tracks) {
    parsed.tracks.forEach(t => {
      if (!Array.isArray(t.tags)) { t.tags = []; changed = true; }
      // Project grouping: each track gets a projectId + version
      if (!t.projectId) { t.projectId = 'proj_' + t.id; changed = true; }
      if (!t.version) { t.version = 'final'; changed = true; }
      if (!t.versionLabel) { t.versionLabel = 'Final'; changed = true; }
      // Per-track diary note + comments
      if (typeof t.artistNote !== 'string') { t.artistNote = ''; changed = true; }
      if (!Array.isArray(t.trackComments)) { t.trackComments = []; changed = true; }
      if (!t.noteColor) { t.noteColor = ['yellow','blue','pink','green','orange','purple'][Math.floor(Math.random()*6)]; changed = true; }
    });
  }

  // Enrich tracks with MORE tags — so the tag cloud is rich
  const tagEnrichment = {
    // Existing ones merged with new genres / moods / years / grade / instruments
    't1': ['1982년 느낌','synthwave','드라이브','new retro wave','레트로','밤','새벽 감성','chill','신디사이저','김음악 음악'],
    't2': ['lofi','비 오는 날','카페 무드','chillhop','보사노바','R&B','일렉피아노','이작곡 음악','mellow','우울'],
    't3': ['synthwave','neon','밤','사이버펑크','드라이브','retro wave','신스','박신스 음악','야경','감성'],
    't4': ['고1 작곡과','봄','어쿠스틱','indie folk','첫 곡','학생 작곡','기타','입학','따뜻함','풋풋함'],
    't5': ['jazz','고3 기타과 음악','밤','bebop','재즈 잼','기타 솔로','박밴드','smooth jazz','ballad','어른스러움'],
    't6': ['funky','드라이브','노을','disco','디스코','70년대 느낌','해변','베이스 라인','이작곡 음악','신남'],
    't7': ['dream pop','밤하늘','감성','신스팝','잠 안 올 때','reverb','슈게이징','김음악 음악','우주','몽환'],
    't8': ['synthwave','새벽','고백','감성적','박신스 음악','신스','고2','밤 운전','멜랑콜리','사랑'],
    't9': ['lofi','커피','비','카페 무드','작업용','공부 BGM','이작곡 음악','잔잔','오전','평온'],
    't10': ['학교','indie rock','고2','하교','청춘','기타 리프','김학생 음악','밴드','풋풋함','에너지']
  };

  if (parsed.tracks) {
    parsed.tracks.forEach(t => {
      const enrich = tagEnrichment[t.id];
      if (enrich && (!t.tags || t.tags.length < enrich.length)) {
        t.tags = enrich;
        changed = true;
      }
    });
    // Also copy tags from parent project to demo versions
    parsed.tracks.forEach(demo => {
      if (demo.isDemo && (!demo.tags || demo.tags.length === 0)) {
        const parent = parsed.tracks.find(p => p.projectId === demo.projectId && p.version === 'final');
        if (parent && parent.tags) {
          demo.tags = [...parent.tags];
          changed = true;
        }
      }
    });
  }

  // Seed diary entries & sample comments for select demos so users see the pattern
  const diarySeeds = {
    // artistNote 는 # 라인 컨벤션 — 데모 카드에 그대로 3줄까지 노출
    't1d1': { artistNote: '#드럼 너무 쎄서 다시 깎아야 함\n#새벽 감성은 아직 부족\n#beat sketch 1', comments: [
      { id:'tc1', author:'이작곡', text:'이 비트 좋다 진심', createdAt:'2026-04-10T03:00:00Z' }
    ]},
    't1d3': { artistNote: '#드럼 깎고 신스 레이어 추가\n#이제 새벽 감성 좀 나는 듯 ✨\n#mix 살짝만 더', comments: [
      { id:'tc2', author:'익명', text:'분위기 미쳤음', createdAt:'2026-04-13T01:20:00Z' }
    ]},
    't1': { artistNote: '#드디어 마스터\n#4번 갈아엎고 나온 결과물\n#새벽 드라이브용 🌙', comments: [
      { id:'tc3', author:'박신스', text:'고생했네 형', createdAt:'2026-04-14T11:00:00Z' },
      { id:'tc4', author:'신스러버', text:'플레이리스트 저장 완료 ♥', createdAt:'2026-04-14T15:00:00Z' }
    ]},
    't6d2': { artistNote: '#제목이 딱 맞았어\n#가사 쓰는데 3일 걸림\n#울컥 모드 🥲', comments: [
      { id:'tc5', author:'익명', text:'제목부터 울림... 가사 궁금해요', createdAt:'2026-04-12T02:00:00Z' },
      { id:'tc6', author:'고1 후배', text:'선배 가사 어케 쓰셨어요?', createdAt:'2026-04-12T14:30:00Z' }
    ]},
    't2': { artistNote: '#비 오는 카페에서 시작\n#원래 더 빠른 템포\n#lofi로 결정', comments: [
      { id:'tc7', author:'익명', text:'카페 사장님한테 추천드리고 싶다 ☕', createdAt:'2026-04-13T16:00:00Z' }
    ]},
    't8d1': { artistNote: '#새벽 4시 폰으로 녹음\n#감정이 제일 날것\n#보이스메모 그대로 살림', comments: []},
    't8d2': { artistNote: '#드럼 연주했는데 아쉽다\n#킥은 더 단단했으면\n#다음에 라이브로 다시', comments: []},
    't8d3': { artistNote: '#다음 곡은 피아노까지 녹음해볼게\n#코러스 멤버 더 뽑아야 하나\n#보컬 톤 고민 중 🎤', comments: []},
    't3d1': { artistNote: '#신스 패드만 깔아놓는 중\n#아직 방향이 안 잡혔어 🤔\n#내일 다시 듣고 결정', comments: [
      { id:'tc8', author:'박밴드', text:'이 패드 소리 뭐 써?', createdAt:'2026-04-11T20:00:00Z' }
    ]}
  };
  if (parsed.tracks) {
    Object.entries(diarySeeds).forEach(([tid, seed]) => {
      const t = parsed.tracks.find(x => x.id === tid);
      if (t) {
        if (!t.artistNote) { t.artistNote = seed.artistNote; changed = true; }
        if (!t.trackComments || t.trackComments.length === 0) { t.trackComments = seed.comments; changed = true; }
      }
    });
  }

  // Seed new final tracks (gives us ~10 total projects)
  const newFinals = [
    {
      id: 't7', title: 'Velvet Sky', artist: '김음악', artistAvatar: 'https://i.pravatar.cc/150?img=11',
      cover: 'https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3',
      likes: 210, plays: 2800, createdAt: '2026-04-14T17:00:00Z',
      tags: ['dream pop', '밤하늘', '감성'], shape: 'hexagon', shapeColor: '#7C4DFF',
      lines: ['#벨벳처럼 부드러운 밤', '#잠 안 올 때 이 곡', '#김음악 Velvet Sky 🌌']
    },
    {
      id: 't8', title: 'Midnight Confession', artist: '박신스', artistAvatar: 'https://i.pravatar.cc/150?img=13',
      cover: 'https://images.unsplash.com/photo-1504509546545-e000b4a62425?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3',
      likes: 178, plays: 1980, createdAt: '2026-04-15T02:00:00Z',
      tags: ['synthwave', '새벽', '고백'], shape: 'diamond', shapeColor: '#EA80FC',
      lines: ['#새벽 고백 synthwave', '#이 곡 들으면 마음이', '#박신스 Midnight Confession']
    },
    {
      id: 't9', title: 'Coffee & Rain', artist: '이작곡', artistAvatar: 'https://i.pravatar.cc/150?img=12',
      cover: 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3',
      likes: 89, plays: 740, createdAt: '2026-04-16T09:00:00Z',
      tags: ['lofi', '커피', '비'], shape: 'oval', shapeColor: '#FFD54F',
      lines: ['#카페 lofi', '#비 오는 오전', '#이작곡 Coffee & Rain ☕']
    },
    {
      id: 't10', title: 'School Bell', artist: '김학생', artistAvatar: 'https://i.pravatar.cc/150?img=20',
      cover: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=500',
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3',
      likes: 62, plays: 310, createdAt: '2026-04-17T15:00:00Z',
      tags: ['학교', 'indie rock', '고2'], shape: 'rect', shapeColor: '#00E5FF',
      lines: ['#하교종 울리면', '#indie rock 좋아해?', '#김학생 School Bell 🔔']
    }
  ];
  newFinals.forEach(f => {
    if (!parsed.tracks.find(t => t.id === f.id)) {
      parsed.tracks.push({
        ...f, youtubeId: '', projectId: 'proj_' + f.id, version: 'final', versionLabel: 'Final'
      });
      changed = true;
    }
  });

  // Demo series per project — rich demo trails
  // Format: [parentId, [demo1 days-before, demo2 days-before, ...]]
  const demoTrails = {
    't1': [
      { n: 1, d: 14, label: 'Demo 1 (rough beat)' },
      { n: 2, d: 11, label: 'Demo 2' },
      { n: 3, d: 8, label: 'Demo 3 (drum 추가)' },
      { n: 4, d: 4, label: 'Demo 4 (pre-mix)' }
    ],
    't2': [
      { n: 1, d: 12, label: 'Demo 1' },
      { n: 2, d: 9, label: 'Demo 2 (tempo 조정)' },
      { n: 3, d: 6, label: 'Demo 3 (vocal take)' },
      { n: 4, d: 2, label: 'Demo 4 (mix)' }
    ],
    't3': [
      { n: 1, d: 10, label: 'Demo 1 (synth만)' },
      { n: 2, d: 8, label: 'Demo 2' },
      { n: 3, d: 5, label: 'Demo 3 (full mix)' },
      { n: 4, d: 1, label: 'Pre-master' }
    ],
    't4': [
      { n: 1, d: 14, label: 'Guitar demo' },
      { n: 2, d: 10, label: 'Demo 2 (코러스 추가)' },
      { n: 3, d: 6, label: 'Demo 3 (vocal)' },
      { n: 4, d: 2, label: 'Pre-master' }
    ],
    't5': [
      { n: 1, d: 18, label: 'Jam session' },
      { n: 2, d: 12, label: 'Demo 2' },
      { n: 3, d: 8, label: 'Demo 3 (sax solo)' },
      { n: 4, d: 3, label: 'Demo 4 (final arr)' }
    ],
    't6': [
      { n: 1, d: 14, label: 'Demo 1' },
      { n: 2, d: 10, label: 'I invest your Feeling' },
      { n: 3, d: 6, label: 'Demo 3 (groove fix)' },
      { n: 4, d: 2, label: 'Demo 4 (mastering prep)' }
    ],
    't7': [
      { n: 1, d: 9, label: 'Demo 1 (pad only)' },
      { n: 2, d: 6, label: 'Demo 2' },
      { n: 3, d: 3, label: 'Demo 3 (full arrangement)' }
    ],
    't8': [
      { n: 1, d: 8, label: 'Voice memo' },
      { n: 2, d: 5, label: 'Demo 2' },
      { n: 3, d: 3, label: 'Demo 3 (arr 수정)' },
      { n: 4, d: 1, label: 'Pre-final' }
    ],
    't9': [
      { n: 1, d: 8, label: 'Coffee Demo' },
      { n: 2, d: 5, label: 'Demo 2 (rain layer)' },
      { n: 3, d: 2, label: 'Demo 3 (final arr)' }
    ],
    't10': [
      { n: 1, d: 9, label: 'Guitar sketch' },
      { n: 2, d: 6, label: 'Demo 2' },
      { n: 3, d: 3, label: 'Demo 3' },
      { n: 4, d: 1, label: 'Demo 4 (final arr)' }
    ]
  };
  const nowMs = Date.now();
  Object.entries(demoTrails).forEach(([parentId, demos]) => {
    const parent = parsed.tracks.find(t => t.id === parentId);
    if (!parent) return;
    demos.forEach(demo => {
      const demoId = parentId + 'd' + demo.n;
      if (!parsed.tracks.find(t => t.id === demoId)) {
        const createdAt = new Date(nowMs - demo.d * 24 * 3600 * 1000).toISOString();
        parsed.tracks.push({
          id: demoId,
          title: parent.title + ' (' + demo.label + ')',
          artist: parent.artist,
          artistAvatar: parent.artistAvatar,
          cover: parent.cover,
          audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-' + ((demo.n + parseInt(parentId.replace(/\D/g, ''), 10)) % 16 + 1) + '.mp3',
          likes: Math.floor(Math.random() * 30),
          plays: Math.floor(Math.random() * 200),
          createdAt,
          youtubeId: '',
          tags: parent.tags || [],
          shape: parent.shape,
          shapeColor: parent.shapeColor,
          lines: parent.lines || [],
          projectId: parent.projectId || ('proj_' + parentId),
          version: 'demo' + demo.n,
          versionLabel: demo.label,
          isDemo: true
        });
        changed = true;
      }
    });
  });

  // 2차 sweep — demoTrails로 갓 생성된 데모 트랙들(t3d1, t8d2 등)에도 diarySeeds 적용
  Object.entries(diarySeeds).forEach(([tid, seed]) => {
    const t = parsed.tracks.find(x => x.id === tid);
    if (t) {
      if (!t.artistNote) { t.artistNote = seed.artistNote; changed = true; }
      if (!Array.isArray(t.trackComments) || t.trackComments.length === 0) {
        t.trackComments = seed.comments; changed = true;
      }
    }
  });

  // Ensure notes exists
  if (!parsed.notes) {
    parsed.notes = MOCK_DATA.notes;
    changed = true;
  }
  // Migrate notes: ensure comments array exists + add sample comments for demo
  if (parsed.notes) {
    parsed.notes.forEach(n => {
      if (!Array.isArray(n.comments)) { n.comments = []; changed = true; }
    });
    // Seed a few sample comments
    const seedComments = {
      'n1': [
        { id: 'c1', author: '이작곡', text: '응 좋아!', createdAt: '2026-04-13T23:00:00Z' },
        { id: 'c2', author: '익명', text: '나도 듣고 싶다 ㅠㅠ', createdAt: '2026-04-14T01:00:00Z' }
      ],
      'n3': [
        { id: 'c3', author: '박밴드', text: '나 껴줘 키보드 침', createdAt: '2026-04-13T19:00:00Z' }
      ]
    };
    Object.entries(seedComments).forEach(([nid, comments]) => {
      const n = parsed.notes.find(x => x.id === nid);
      if (n && (!n.comments || n.comments.length === 0)) {
        n.comments = comments;
        changed = true;
      }
    });
  }

  // Migrate playlists: trackCount -> trackIds
  if (parsed.playlists) {
    parsed.playlists.forEach(p => {
      if (!p.trackIds) { p.trackIds = []; delete p.trackCount; changed = true; }
    });
  }
  // Migrate following: add sns
  if (parsed.following) {
    parsed.following.forEach(a => {
      if (!a.sns) { a.sns = { instagram: '', youtube: '', tiktok: '', twitter: '' }; changed = true; }
    });
  }
  // Migrate currentUser: add sns
  if (parsed.currentUser && !parsed.currentUser.sns) {
    parsed.currentUser.sns = {};
    changed = true;
  }
  // Migrate currentUser: add followingArtists (list of artist names they fan)
  if (parsed.currentUser && !Array.isArray(parsed.currentUser.followingArtists)) {
    parsed.currentUser.followingArtists = [];
    changed = true;
  }

  // Ensure fanLetters collection exists — per-artist handwritten letters from fans
  if (!Array.isArray(parsed.fanLetters)) {
    parsed.fanLetters = [
      { id: 'fl1', artistName: '이작곡', author: '익명 팬', text: '비 오는 날마다 선배 노래 들어요\n진짜 최고 ☔💙', color: 'blue', rotation: -2.2, createdAt: '2026-04-14T12:00:00Z' },
      { id: 'fl2', artistName: '이작곡', author: '고1 후배', text: '저도 나중에 선배처럼\n작곡하고 싶어요!!', color: 'pink', rotation: 1.8, createdAt: '2026-04-15T09:30:00Z' },
      { id: 'fl3', artistName: '박신스', author: '신스러버', text: 'Neon Horizon 데모부터\n마스터까지 다 들었어요 👏', color: 'purple', rotation: -1.5, createdAt: '2026-04-13T20:45:00Z' },
      { id: 'fl4', artistName: '김음악', author: '익명', text: '첫 트랙인데 너무 좋아요\n다음 곡 기다릴게요 ✨', color: 'yellow', rotation: 2.1, createdAt: '2026-04-14T22:10:00Z' }
    ];
    changed = true;
  }
  // Ensure every artist has a followers count (default 0)
  if (parsed.following) {
    parsed.following.forEach(a => {
      if (typeof a.followers !== 'number') { a.followers = 0; changed = true; }
    });
  }

  // === LISTENER PERSONA SEED: "라일락" (IR demo viewer) ===
  // Pre-populates current listener with realistic backings/bookmarks/followers
  // so investors viewing the demo see a populated 청취자 page immediately.
  // Runs once per DATA_VERSION (controlled by offstage_listener_seed marker).
  const LISTENER_SEED_KEY = 'offstage_listener_seed_v' + DATA_VERSION;
  if (!localStorage.getItem(LISTENER_SEED_KEY)) {
    // currentUser persona — 라일락 (Lilac)
    // FORCE override — IR demo needs predictable state. Override regardless of
    // existing currentUser (previous nickname/login won't block the demo seed).
    parsed.currentUser = {
      name: '라일락',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400',
      role: 'listener',
      bio: '인디 음악 + K-pop 사이 어딘가. STO로 좋아하는 아티스트와 같이 만드는 게 인생 낙 🌸',
      sns: { instagram: 'https://instagram.com/lilac_listener', youtube: '', tiktok: '', twitter: '' },
      followingArtists: ['Peek', '엔젤노이즈', 'SM Entertainment', '루시드 베어', '박신스']
    };
    changed = true;

    // myBackings — 라일락의 후원 이력 (총 32만원)
    try {
      const seedBackings = [
        { trackId: 'tp1',  amount: 30000,  artistName: 'Peek',              trackTitle: 'kiss kiss kiss type',           createdAt: '2026-04-28T20:00:00Z' },
        { trackId: 'tp1d1',amount: 10000,  artistName: 'Peek',              trackTitle: 'kiss kiss kiss type (Beat)',    createdAt: '2026-04-16T11:00:00Z' },
        { trackId: 'tp1d2',amount: 8000,   artistName: 'Peek',              trackTitle: 'kiss kiss kiss type (+ Vocal)', createdAt: '2026-04-22T22:30:00Z' },
        { trackId: 'tsm1', amount: 100000, artistName: 'SM Entertainment',  trackTitle: 'Velvet Garden',                 createdAt: '2025-12-02T15:00:00Z' },
        { trackId: 'tsm4', amount: 100000, artistName: 'SM Entertainment',  trackTitle: 'Eclipse (UNRELEASED demo)',     createdAt: '2026-05-10T23:00:00Z' },
        { trackId: 't_angel2', amount: 50000, artistName: '엔젤노이즈',     trackTitle: 'Bedroom Window (Demo)',         createdAt: '2026-03-28T18:00:00Z' },
        { trackId: 't_lucid2', amount: 30000, artistName: '루시드 베어',    trackTitle: '하굣길 라떼 demo',              createdAt: '2026-03-15T20:00:00Z' }
      ];
      localStorage.setItem('offstage_my_backings', JSON.stringify(seedBackings));
    } catch (_) {}

    // Bookmarked notes — 라일락이 수집한 포스트잇
    try {
      localStorage.setItem('offstage_bookmarks', JSON.stringify(['n21','n10','n23','n14','n19']));
    } catch (_) {}

    // 라일락 자신이 작성한 포스트잇 ID 매핑
    try {
      localStorage.setItem('offstage_my_notes', JSON.stringify(['n22']));
    } catch (_) {}

    // Followed artists (Supabase follow simulation)
    try {
      localStorage.setItem('offstage_followed_artists', JSON.stringify(['Peek','엔젤노이즈','SM Entertainment','루시드 베어','박신스']));
    } catch (_) {}

    localStorage.setItem(LISTENER_SEED_KEY, '1');
  }

  if (changed) localStorage.setItem('offstage_data', JSON.stringify(parsed));
}

window.DB = {
  get: () => {
    // Bulletproof: handle corrupted/missing localStorage gracefully
    try {
      const raw = localStorage.getItem('offstage_data');
      if (!raw) {
        // Re-seed if wiped
        localStorage.setItem('offstage_data', JSON.stringify(MOCK_DATA));
        return JSON.parse(JSON.stringify(MOCK_DATA));
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      // Ensure essential arrays exist (defensive)
      if (!Array.isArray(parsed.tracks)) parsed.tracks = [];
      if (!Array.isArray(parsed.notes)) parsed.notes = [];
      if (!Array.isArray(parsed.playlists)) parsed.playlists = [];
      return parsed;
    } catch (e) {
      console.warn('[DB] localStorage corrupted, re-seeding', e);
      try {
        localStorage.setItem('offstage_data', JSON.stringify(MOCK_DATA));
        return JSON.parse(JSON.stringify(MOCK_DATA));
      } catch (e2) {
        // localStorage full or disabled — return in-memory copy
        return JSON.parse(JSON.stringify(MOCK_DATA));
      }
    }
  },
  save: (data) => {
    try {
      localStorage.setItem('offstage_data', JSON.stringify(data));
    } catch (e) {
      console.warn('[DB] save failed (storage full?)', e);
    }
  },
  addTrack: (track) => {
    const data = window.DB.get();
    data.tracks.unshift(track); // prepend
    window.DB.save(data);
  },
  addReservation: (res) => {
    const data = window.DB.get();
    data.reservations.push(res);
    window.DB.save(data);
  },
  addTrackToPlaylist: (playlistId, trackId) => {
    const data = window.DB.get();
    const pl = data.playlists.find(p => p.id === playlistId);
    if (pl && !pl.trackIds.includes(trackId)) {
      pl.trackIds.push(trackId);
      window.DB.save(data);
    }
  },
  removeTrackFromPlaylist: (playlistId, trackId) => {
    const data = window.DB.get();
    const pl = data.playlists.find(p => p.id === playlistId);
    if (pl) {
      pl.trackIds = pl.trackIds.filter(id => id !== trackId);
      window.DB.save(data);
    }
  },
  createPlaylist: (title) => {
    const data = window.DB.get();
    const newPl = { id: 'p' + Date.now(), title, cover: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500', trackIds: [] };
    data.playlists.push(newPl);
    window.DB.save(data);
    return newPl;
  },
  addNote: (note) => {
    const data = window.DB.get();
    if (!data.notes) data.notes = [];
    data.notes.unshift(note);
    window.DB.save(data);
  },
  deleteNote: (noteId) => {
    const data = window.DB.get();
    if (!data.notes) return;
    data.notes = data.notes.filter(n => n.id !== noteId);
    window.DB.save(data);
  },
  addNoteComment: (noteId, comment) => {
    const data = window.DB.get();
    const n = (data.notes || []).find(x => x.id === noteId);
    if (!n) return;
    if (!Array.isArray(n.comments)) n.comments = [];
    n.comments.push(comment);
    window.DB.save(data);
  },
  setArtistNote: (trackId, note) => {
    const data = window.DB.get();
    const t = data.tracks.find(x => x.id === trackId);
    if (!t) return;
    t.artistNote = note;
    window.DB.save(data);
  },
  addTrackComment: (trackId, comment) => {
    const data = window.DB.get();
    const t = data.tracks.find(x => x.id === trackId);
    if (!t) return;
    if (!Array.isArray(t.trackComments)) t.trackComments = [];
    t.trackComments.push(comment);
    window.DB.save(data);
  },
  addFanLetter: (letter) => {
    const data = window.DB.get();
    if (!Array.isArray(data.fanLetters)) data.fanLetters = [];
    data.fanLetters.unshift(letter);
    window.DB.save(data);
  },
  deleteFanLetter: (id) => {
    const data = window.DB.get();
    if (!data.fanLetters) return;
    data.fanLetters = data.fanLetters.filter(l => l.id !== id);
    window.DB.save(data);
  },
  toggleFollow: (artistName) => {
    const data = window.DB.get();
    if (!data.currentUser) return false;
    if (!Array.isArray(data.currentUser.followingArtists)) data.currentUser.followingArtists = [];
    const idx = data.currentUser.followingArtists.indexOf(artistName);
    let artist = (data.following || []).find(a => a.name === artistName);
    if (!artist) {
      const trackArtist = data.tracks.find(t => t.artist === artistName);
      artist = {
        id: 'u_' + Date.now(),
        name: artistName,
        avatar: trackArtist?.artistAvatar || 'https://i.pravatar.cc/150',
        followers: 0,
        sns: { instagram: '', youtube: '', tiktok: '', twitter: '' }
      };
      if (!data.following) data.following = [];
      data.following.push(artist);
    }
    let nowFollowing;
    if (idx >= 0) {
      data.currentUser.followingArtists.splice(idx, 1);
      artist.followers = Math.max(0, (artist.followers || 0) - 1);
      nowFollowing = false;
    } else {
      data.currentUser.followingArtists.push(artistName);
      artist.followers = (artist.followers || 0) + 1;
      nowFollowing = true;
    }
    window.DB.save(data);
    return nowFollowing;
  },
  isFollowing: (artistName) => {
    const data = window.DB.get();
    return !!(data.currentUser && data.currentUser.followingArtists && data.currentUser.followingArtists.includes(artistName));
  },
  getFollowerCount: (artistName) => {
    const data = window.DB.get();
    const a = (data.following || []).find(x => x.name === artistName);
    return a?.followers || 0;
  }
};
