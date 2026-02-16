import { forwardRef, useEffect, useRef, useImperativeHandle, useState } from 'react';
import { Camera } from 'lucide-react';

export interface VideoPlayerHandle {
    seekTo: (seconds: number) => void;
    getDuration: () => number;
    togglePlayPause: () => void;
    isPlaying: () => boolean;
    getPlayerResponse: () => any;
}

interface VideoPlayerProps {
    url: string;
    onProgress?: (state: { playedSeconds: number }) => void;
    onDuration?: (duration: number) => void;
    onSnapshot?: (timestamp: number) => void;
}

// Minimal Type Definitions for YouTube Iframe API
interface YTPlayer {
    loadVideoById: (videoId: string) => void;
    seekTo: (seconds: number, allowSeekAhead: boolean) => void;
    getCurrentTime: () => number;
    getDuration: () => number;
    playVideo: () => void;
    pauseVideo: () => void;
    getPlayerState: () => number;
    destroy: () => void;
    getPlayerResponse?: () => any;
}

interface YTEvent {
    target: YTPlayer;
    data: number;
}

declare global {
    interface Window {
        onYouTubeIframeAPIReady: () => void;
        YT: {
            Player: new (element: HTMLElement, config: any) => YTPlayer;
            PlayerState: {
                PLAYING: number;
                PAUSED: number;
                ENDED: number;
            };
        };
    }
}

// Extract Video ID helper
const getYouTubeID = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : "";
};

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ url, onProgress, onDuration, onSnapshot }, ref) => {
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const playerInstanceRef = useRef<YTPlayer | null>(null);
    // Initialize based on current window state to avoid sync setState in effect
    const [isApiReady, setIsApiReady] = useState(() => typeof window !== 'undefined' && !!window.YT);
    const videoId = getYouTubeID(url);

    // 1. Load YouTube Iframe API Script
    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            // Ensure we append to head or body safely
            document.body.appendChild(tag);

            window.onYouTubeIframeAPIReady = () => {
                setIsApiReady(true);
            };
        }
    }, []); // Empty dependency array as we only want to load script once

    // 2. Initialize Player when API is ready OR url changes
    useEffect(() => {
        if (!isApiReady || !videoId || !playerContainerRef.current) return;

        // If player already exists, just load new video
        if (playerInstanceRef.current) {
            playerInstanceRef.current.loadVideoById(videoId);
            return;
        }

        // Initialize new player
        playerInstanceRef.current = new window.YT.Player(playerContainerRef.current, {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                'playsinline': 1,
                'modestbranding': 1,
                'rel': 0
            },
            events: {
                'onReady': (event: YTEvent) => {
                    if (onDuration) {
                        onDuration(event.target.getDuration());
                    }
                },
                'onStateChange': (event: YTEvent) => {
                    // 1 = Playing
                    if (event.data === 1 && onDuration) {
                        onDuration(event.target.getDuration());
                    }
                }
            }
        });

        // Cleanup
        return () => {
            if (playerInstanceRef.current) {
                try {
                    playerInstanceRef.current.destroy();
                } catch (e) {
                    console.error("Error destroying player:", e);
                }
                playerInstanceRef.current = null;
            }
        }
    }, [isApiReady, videoId, onDuration]);

    // 3. Polling for progress (Native API doesn't have onProgress)
    useEffect(() => {
        const interval = setInterval(() => {
            if (playerInstanceRef.current && playerInstanceRef.current.getCurrentTime && onProgress) {
                const time = playerInstanceRef.current.getCurrentTime();
                onProgress({ playedSeconds: time });
            }
        }, 500);

        return () => clearInterval(interval);
    }, [onProgress]);

    // 4. Expose methods via ref
    useImperativeHandle(ref, () => ({
        seekTo: (seconds: number) => {
            if (playerInstanceRef.current && playerInstanceRef.current.seekTo) {
                playerInstanceRef.current.seekTo(seconds, true);
                playerInstanceRef.current.playVideo();
            }
        },
        getCurrentTime: () => {
            if (playerInstanceRef.current && playerInstanceRef.current.getCurrentTime) {
                return playerInstanceRef.current.getCurrentTime();
            }
            return 0;
        },
        getDuration: () => {
            if (playerInstanceRef.current && playerInstanceRef.current.getDuration) {
                return playerInstanceRef.current.getDuration();
            }
            return 0;
        },
        togglePlayPause: () => {
            if (!playerInstanceRef.current) return;
            const state = playerInstanceRef.current.getPlayerState();
            // YT.PlayerState.PLAYING === 1
            if (state === 1) {
                playerInstanceRef.current.pauseVideo();
            } else {
                playerInstanceRef.current.playVideo();
            }
        },
        isPlaying: () => {
            if (!playerInstanceRef.current || !playerInstanceRef.current.getPlayerState) return false;
            return playerInstanceRef.current.getPlayerState() === 1;
        },
        getPlayerResponse: () => {
            if (playerInstanceRef.current && playerInstanceRef.current.getPlayerResponse) {
                return playerInstanceRef.current.getPlayerResponse();
            }
            return null;
        }
    }));

    // Flash state for snapshot feedback
    const [flash, setFlash] = useState(false);

    const handleSnapshot = () => {
        if (playerInstanceRef.current && playerInstanceRef.current.getCurrentTime && onSnapshot) {
            const time = playerInstanceRef.current.getCurrentTime();
            onSnapshot(time);

            // Trigger Flash
            setFlash(true);
            setTimeout(() => setFlash(false), 200);
        }
    };

    return (
        <div className="relative w-full h-full aspect-video bg-black group overflow-hidden">
            {/* The div where Iframe will be mounted */}
            <div ref={playerContainerRef} className="w-full h-full" />

            {/* Snapshot Button */}
            <button
                onClick={handleSnapshot}
                className="absolute top-4 right-4 z-20 p-2.5 bg-black/60 hover:bg-black/80 text-white/90 hover:text-white rounded-xl transition-all opacity-0 group-hover:opacity-100 backdrop-blur-md border border-white/10 shadow-lg transform active:scale-95"
                title="Take Snapshot"
            >
                <Camera className="w-5 h-5" />
            </button>

            {/* Flash Overlay */}
            <div
                className={`absolute inset-0 bg-white z-50 pointer-events-none transition-opacity duration-200 ease-out ${flash ? 'opacity-40' : 'opacity-0'}`}
            />
        </div>
    );
});

VideoPlayer.displayName = 'VideoPlayer';
