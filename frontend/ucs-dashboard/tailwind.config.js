/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			neon: {
  				cyan: '#00F0FF',
  				purple: '#A020F0',
  				aqua: '#7FFFD4',
  				amber: '#FFB800',
  				red: '#FF3B5C',
  				green: '#00FF88',
  			},
  			dark: {
  				primary: '#0A0F1F',
  				secondary: '#111827',
  				tertiary: '#1E293B',
  			},
  		},
  		fontFamily: {
  			display: ['Orbitron', 'system-ui', 'sans-serif'],
  			mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'neon-pulse': {
  				'0%, 100%': { opacity: '1' },
  				'50%': { opacity: '0.6' },
  			},
  			'glow-breathe': {
  				'0%, 100%': { boxShadow: '0 0 5px rgba(0,240,255,0.2)' },
  				'50%': { boxShadow: '0 0 20px rgba(0,240,255,0.4)' },
  			},
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'neon-pulse': 'neon-pulse 2s ease-in-out infinite',
  			'glow-breathe': 'glow-breathe 3s ease-in-out infinite',
  		},
  		backdropBlur: {
  			xs: '2px',
  		},
  	}
  },
  plugins: [import("tailwindcss-animate")],
}

