<!-- Navbar.svelte -->
<script lang="ts">
  import logo from '$lib/assets/logo.png';
  import logoTitle from '$lib/assets/logo_title.png';
  import { Dumbbell, Trophy, HelpCircle, Book, Coins, Menu, X, Github, Database, ChevronDown } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import WalletMultiButton from '$lib/components/solana/WalletMultiButton.svelte';
  import { slide } from 'svelte/transition';

  let isScrolled = false;
  let isMobileMenuOpen = false;
  let isResearchDropdownOpen = false;

  onMount(() => {
    const handleScroll = () => {
      isScrolled = window.scrollY > 20;
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  });

  function handleResearchDropdown() {
    isResearchDropdownOpen = !isResearchDropdownOpen;
  }

  function closeResearchDropdown() {
    setTimeout(() => isResearchDropdownOpen = false, 200);
  }

  function toggleMobileMenu() {
    isMobileMenuOpen = !isMobileMenuOpen;
  }

  function closeMobileMenu() {
    isMobileMenuOpen = false;
  }
</script>

<div class="fixed left-0 right-0 top-0 z-50 transition-all duration-300">
  <div
    class="absolute inset-0 border-b border-white/10 bg-black/50 backdrop-blur-lg transition-opacity duration-300"
    class:opacity-0={!isScrolled}
    class:opacity-100={isScrolled}
  ></div>

  <div class="relative z-10 mx-auto max-w-7xl px-6">
    <div class="flex h-16 items-center justify-between">
      <!-- Left side with logo -->
      <div class="flex items-center space-x-8">
        <a href="/" class="group flex items-center">
          <img
            src={logo}
            alt="ViralMind"
            class="hidden h-8 w-8 transition-transform group-hover:scale-105 lg:block"
          />
          <img
            src={logoTitle}
            alt="ViralMind"
            class="lg:hiddne h-8 transition-transform group-hover:scale-105 lg:hidden"
          />
        </a>

        <!-- Desktop Navigation -->
        <nav class="hidden items-center space-x-8 lg:flex">
          <!-- <a
            href="/tournaments"
            class="group flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
          >
            <Trophy class="h-4 w-4 transition-transform group-hover:scale-110" />
            Tournaments
          </a> -->
          
          <a href="/viral" class="group flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white">
            <Coins class="h-4 w-4 transition-transform group-hover:scale-110" />
            $VIRAL
          </a>
          <a
            href="https://docs.viralmind.ai/"
            target="_blank"
            class="group flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
          >
            <Github class="h-4 w-4 transition-transform group-hover:scale-110" />
            GitHub
          </a>
          <a
            href="https://docs.viralmind.ai/"
            target="_blank"
            class="group flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
          >
            <Book class="h-4 w-4 transition-transform group-hover:scale-110" />
            Docs
          </a>
          <!-- <a
            href="/#faq"
            class="group flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
          >
            <HelpCircle class="h-4 w-4 transition-transform group-hover:scale-110" />
            FAQ
          </a> -->
          
          <!-- Research Dropdown -->
          <div class="relative">
            <button
              class="group flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
              onclick={handleResearchDropdown}
              onblur={closeResearchDropdown}
            >
              <Database class="h-4 w-4 transition-transform group-hover:scale-110" />
              Research
              <ChevronDown class="h-4 w-4" />
            </button>
            
            {#if isResearchDropdownOpen}
              <div
                class="absolute left-0 mt-2 w-48 rounded-lg border border-purple-500/20 bg-black/95 py-2 backdrop-blur-lg"
                transition:slide
              >
                <a
                  href="/datasets"
                  class="block px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-purple-500/20 hover:text-white"
                >
                  Datasets
                </a>
              </div>
            {/if}
          </div>

        </nav>
      </div>

      <!-- Right side -->
      <div class="flex items-center space-x-4">
        <div class="hidden sm:block">
          <WalletMultiButton />
        </div>
        <a
          href="/gym"
          class="group hidden items-center gap-3 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 py-1 pl-4 pr-5 text-sm font-medium text-black shadow-lg shadow-amber-500/20 transition-all hover:scale-[1.02] hover:from-amber-400 hover:to-yellow-400 hover:shadow-amber-500/30 sm:flex"
        >
          <div class="rounded-full bg-black/10 p-1">
            <Dumbbell class="h-4 w-4 transition-transform group-hover:scale-110" />
          </div>
          <div class="flex items-center gap-1">
            <span>Earn</span>
            <span class="font-bold">$VIRAL</span>
            <span class="hidden font-medium opacity-80 lg:inline">by Training →</span>
          </div>
        </a>

        <!-- Mobile menu button -->
        <button
          class="rounded-full p-2 text-gray-300 transition-colors hover:bg-white/5 hover:text-white lg:hidden"
          onclick={toggleMobileMenu}
        >
          {#if isMobileMenuOpen}
            <X class="h-6 w-6" />
          {:else}
            <Menu class="h-6 w-6" />
          {/if}
        </button>
      </div>
    </div>

    <!-- Mobile Navigation Menu -->
    {#if isMobileMenuOpen}
      <div
        transition:slide
        class="absolute left-0 right-0 top-16 border-b border-white/10 bg-black/95 backdrop-blur-lg md:hidden"
      >
        <nav class="space-y-4 px-6 py-4">
          <a
            href="/tournaments"
            onclick={closeMobileMenu}
            class="flex items-center gap-3 py-2 text-gray-300 transition-colors hover:text-white"
          >
            <Trophy class="h-5 w-5" />
            Tournaments
          </a>
          
          <a
            href="/viral"
            onclick={() => (isMobileMenuOpen = false)}
            class="flex items-center gap-3 py-2 text-gray-300 transition-colors hover:text-white"
          >
            <Coins class="h-5 w-5" />
            $VIRAL
          </a>
          <a
            href="https://github.com/viralmind-ai/viralmind-agents"
            target="_blank"
            class="flex items-center gap-3 py-2 text-gray-300 transition-colors hover:text-white"
          >
            <Github class="h-5 w-5" />
            GitHub
          </a>
          <a
            href="https://docs.viralmind.ai/"
            target="_blank"
            class="flex items-center gap-3 py-2 text-gray-300 transition-colors hover:text-white"
          >
            <Book class="h-5 w-5" />
            Docs
          </a>
          <a
            href="/#faq"
            onclick={() => (isMobileMenuOpen = false)}
            class="flex items-center gap-3 py-2 text-gray-300 transition-colors hover:text-white"
          >
            <HelpCircle class="h-5 w-5" />
            FAQ
          </a>

          <a href="/gym" class="flex items-center gap-3 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-500 px-2 py-2 text-black transition-colors">
            <Dumbbell class="h-5 w-5" />
            Training Gym
          </a>

          <!-- Mobile Research section -->
          <div class="border-t border-white/10 pt-2">
            <p class="px-2 py-1 text-xs font-semibold uppercase text-gray-500">Research</p>
            <a
              href="/datasets"
              onclick={closeMobileMenu}
              class="flex items-center gap-3 py-2 text-gray-300 transition-colors hover:text-white"
            >
              <Database class="h-5 w-5" />
              Datasets
            </a>
          </div>

          <div class="py-2">
            <WalletMultiButton />
          </div>
        </nav>
      </div>
    {/if}
  </div>
</div>

<!-- Spacer -->
<div class="h-16"></div>