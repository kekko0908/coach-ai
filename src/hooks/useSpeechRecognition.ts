import { useEffect, useMemo, useRef, useState } from 'react';

interface UseSpeechRecognitionOptions {
  lang?: string;
  onTranscript: (value: string) => void;
}

export function useSpeechRecognition({
  lang = 'it-IT',
  onTranscript,
}: UseSpeechRecognitionOptions) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionApi();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }

      onTranscript(transcript.trimStart());
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      if (event.error !== 'no-speech') {
        setError(event.error);
      }
    };

    recognitionRef.current = recognition;
    setIsSupported(true);

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [lang, onTranscript]);

  const controls = useMemo(() => ({
    start: () => {
      if (!recognitionRef.current || isListening) {
        return;
      }

      setError(null);
      setIsListening(true);
      recognitionRef.current.start();
    },
    stop: () => {
      recognitionRef.current?.stop();
      setIsListening(false);
    },
  }), [isListening]);

  return {
    isSupported,
    isListening,
    error,
    startListening: controls.start,
    stopListening: controls.stop,
  };
}
