<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Palette,
    Video,
    FileSpreadsheet,
    Globe2,
    MousePointer,
    Sparkles,
    Brain,
    Music,
    Coffee,
    Gamepad,
    Dice5,
    Monitor,
    Gamepad2,
    Crosshair,
    Zap,
    Move,
    TrendingUp,
    LineChart
  } from 'lucide-svelte';
  import FeaturedRace from '$lib/components/gym/FeaturedRace.svelte';
  import CategorySection from '$lib/components/gym/CategorySection.svelte';
  import SubmitRace from '$lib/components/gym/SubmitRace.svelte';
  import RaceWarningModal from '$lib/components/gym/RaceWarningModal.svelte';
  import type { Race, Category } from '$lib/types';

  // Icon mapping for each race icon
  const iconMap: Record<string, any> = {
    Palette: Palette,
    FileSpreadsheet: FileSpreadsheet,
    Video: Video,
    Globe2: Globe2,
    MousePointer: MousePointer,
    Crosshair: Crosshair,
    Zap: Zap,
    Move: Move,
    Gamepad: Gamepad,
    Dice5: Dice5,
    TrendingUp: TrendingUp,
    LineChart: LineChart,
    Monitor: Monitor,
    Brain: Brain,
    Music: Music
  };

  // Category metadata
  const categoryMeta: Record<string, { title: string; icon: any }> = {
    creative: {
      title: 'Creative Chaos',
      icon: Sparkles
    },
    mouse: {
      title: 'Mouse Skills',
      icon: MousePointer
    },
    slacker: {
      title: 'Slacker Skills',
      icon: Coffee
    },
    gaming: {
      title: 'Gaming',
      icon: Gamepad2
    }
  };

  let categories: Category[] = [];

  async function fetchRaces() {
    try {
      const response = await fetch('/api/races');
      const races: Race[] = await response.json();

      // Filter out staked races and group by category
      const freeRaces = races.filter((race) => !race.stakeRequired);
      const groupedRaces: Record<string, Race[]> = freeRaces.reduce(
        (acc: Record<string, Race[]>, race) => {
          if (!acc[race.category]) {
            acc[race.category] = [];
          }
          acc[race.category].push(race);
          return acc;
        },
        {} as Record<string, Race[]>
      );

      // Convert grouped races to categories array
      categories = Object.entries(groupedRaces).map(
        ([id, races]): Category => ({
          id,
          title: categoryMeta[id]?.title || id,
          icon: categoryMeta[id]?.icon || Brain,
          races
        })
      );
    } catch (error) {
      console.error('Error fetching races:', error);
    }
  }

  const wildcardRace: Race = {
    id: 'wildcard',
    title: 'AI Wildcard Challenge',
    description: 'Our AI guides you through random desktop tasks',
    colorScheme: 'purple',
    prompt: 'Random task generated by AI',
    reward: 150,
    buttonText: 'Join Race',
    category: 'wildcard',
    stakeRequired: 0
  };

  let mousePosition = { x: 0, y: 0 };

  function handleMouseMove(event: MouseEvent) {
    mousePosition.x = (event.clientX / window.innerWidth) * 100;
    mousePosition.y = (event.clientY / window.innerHeight) * 100;
  }

  onMount(() => {
    window.addEventListener('mousemove', handleMouseMove);
    fetchRaces();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  });
</script>

<div class="min-h-screen bg-black pb-24 pt-12 text-white">
  <div class="relative flex min-h-screen flex-col items-start justify-center overflow-hidden">
    <!-- Content Container -->
    <div class="relative z-10 mx-auto w-full max-w-[1400px] px-8">
      <!-- Main Title -->
      <h1 class="my-6 text-5xl font-bold drop-shadow-lg md:text-7xl">Free Races</h1>

      <!-- Subtitle -->
      <p class="mb-12 max-w-2xl text-xl text-gray-400 md:text-2xl">
        Join our AI assistants in fun desktop challenges and earn $VIRAL tokens
      </p>

      <div class="mb-12">
        <!-- Featured Wildcard Section -->
        <FeaturedRace race={wildcardRace} icon={Brain} />
      </div>

      <!-- Categories -->
      {#each categories as category}
        <CategorySection {category} {iconMap} />
      {/each}

      <!-- Notification Sign Up -->
      <SubmitRace />
    </div>

    <!-- Single modal instance for the entire page -->
    <RaceWarningModal />
  </div>

  <!-- Background effects -->
  <div class="absolute inset-0 z-[1] bg-gradient-to-b from-purple-900/20 to-black"></div>
  <div
    class="absolute inset-0 z-[2] transition-transform duration-1000 ease-out"
    style="background: radial-gradient(600px circle at {mousePosition.x}% {mousePosition.y}%, rgb(147, 51, 234, 0.1), transparent 100%); 
            transform: translate({(mousePosition.x - 50) * -0.05}px, {(mousePosition.y - 50) *
      -0.05}px)"
  ></div>
  <div class="absolute inset-0 z-[3] bg-gradient-to-b from-black via-transparent to-black"></div>
</div>
