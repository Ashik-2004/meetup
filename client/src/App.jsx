import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, ChevronRight, CircleAlert,
  Copy, ExternalLink, LockKeyhole, MapPin, Menu, MessageCircle, Plus, ShieldCheck,
  Users, X, LogOut, Send, LoaderCircle, Train, Bus, Car, Bike, Footprints, Mail,
} from 'lucide-react';
import { api, ApiError } from './api.js';
import { consentPolicy } from './consentConfig.js';
import { clearAccountScopedState, clearInactiveEventState, eventMatchingStatus, isCurrentAuthResponse, isEventMatchingEnabled, isLikelyDetailedAddress, isMatchingActionDisabled, normalizeMatchGenders, publicLandingEvents } from './sessionPolicy.js';

const travelModes = ['Train', 'Bus', 'Car', 'Bike', 'Walking / meeting at venue', 'Other', 'Not decided yet'];
const genderOptions = [
  ['woman', 'Woman'], ['man', 'Man'], ['nonbinary', 'Non-binary'], ['prefer_not_to_say', 'Prefer not to say'],
];
const EMPTY_TRAVEL = {};
const modeIcon = { Train, Bus, Car, Bike, 'Walking / meeting at venue': Footprints };
const dateLabel = (date) => date ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) : 'Date to be confirmed';
const timeLabel = (time) => time ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(`2000-01-01T${time}:00`)) : '';
const splitList = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);

function Button({ children, variant = 'primary', className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}
function Field({ label, hint, children, required = false, className = '' }) {
  return <label className={`field ${className}`}>
    <span className="field-label">{label}{required && <span className="required"> *</span>}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>;
}
function Notice({ kind = 'success', children, onClose }) {
  if (!children) return null;
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'} aria-live={kind === 'error' ? 'assertive' : 'polite'}>
    {kind === 'error' ? <CircleAlert size={16} /> : <Check size={16} />}
    <span>{children}</span>{onClose && <button className="icon-button notice-close" onClick={onClose} aria-label="Dismiss message"><X size={15} /></button>}
  </div>;
}
function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}
function Modal({ title, children, onClose, footer }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || [])];
    (focusable()[0] || dialog)?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog?.focus(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex="-1">
      <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
      <div className="modal-content">{children}</div>{footer && <div className="modal-footer">{footer}</div>}
    </section>
  </div>;
}
function EventDate({ event }) {
  return <div className="event-date"><CalendarDays size={15} aria-hidden="true" /><span>{dateLabel(event.eventDate)}{event.startTime ? ` · ${timeLabel(event.startTime)}` : ''}</span></div>;
}
function ModePills({ modes = [] }) {
  if (!modes.length) return <span className="muted small">Travel plan not added</span>;
  return <div className="mode-pills">{modes.map((mode) => {
    const Icon = modeIcon[mode];
    return <span className="mode-pill" key={mode}>{Icon && <Icon size={13} aria-hidden="true" />}{mode}</span>;
  })}</div>;
}
function EmptyState({ title, body, action }) {
  return <div className="empty-state"><div className="empty-mark"><CalendarDays size={19} /></div><h3>{title}</h3><p>{body}</p>{action}</div>;
}
function Spinner({ label = 'Loading' }) { return <div className="loading-state" role="status"><LoaderCircle size={18} className="spin" />{label}</div>; }

function Landing({ events, loading, onOpenEvent, onJoin, onCoordinator }) {
  return <div className="landing-page">
    <section className="hero-shell">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> THE EVENT TRAVEL COMMUNITY</div>
        <h1>Meet people<br />going <em>your way.</em></h1>
        <p>Going to an event in a city where you know nobody? Find attendees with compatible travel plans — and keep your identity private until you both agree to connect.</p>
        <div className="hero-actions"><Button onClick={onJoin}>Explore events <ArrowRight size={16} /></Button><Button variant="outline" onClick={onCoordinator}>I'm hosting an event</Button></div>
        <div className="privacy-note"><LockKeyhole size={15} /><span>Private by default. Your profile is revealed only after the other person accepts.</span></div>
      </div>
      <div className="hero-art" aria-label="Illustration of an event journey">
        <div className="route-card route-card-top"><div className="route-line"><span className="route-pin"><MapPin size={16} /></span><span className="route-stroke" /><span className="route-pin route-pin-end"><MapPin size={16} /></span></div><div className="route-points"><span>Your city</span><span>Event city</span></div><div className="route-caption">Illustrative journey · not a live match</div></div>
        <div className="hero-event-tag"><CalendarDays size={17} /><div><strong>Same event</strong><span>Different cities. Shared plans.</span></div></div>
        <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
        <div className="hero-stamp"><ShieldCheck size={20} /><span>Consent<br />comes first</span></div>
      </div>
    </section>
    <section className="how-section">
      <div className="section-heading"><div><div className="eyebrow">A BETTER WAY TO ARRIVE</div><h2>Make the journey part of the plan.</h2></div><p>Join an event community without opting into matching. Choose whether you want a travel companion, then discover compatible attendees anonymously.</p></div>
      <div className="steps-grid">
        <article className="step-card"><span className="step-number">01</span><h3>Join the event</h3><p>Open an invitation and join the community. Your event membership and travel matching stay separate.</p></article>
        <article className="step-card"><span className="step-number">02</span><h3>Set your travel plan</h3><p>Add your city, approximate starting area and travel method. Choose if you want to meet someone.</p></article>
        <article className="step-card"><span className="step-number">03</span><h3>Connect by consent</h3><p>Send an anonymous request. Names and approved profile details appear only after acceptance.</p></article>
      </div>
    </section>
    <section className="event-list-section" id="events">
      <div className="section-heading"><div><div className="eyebrow">OPEN INVITATIONS</div><h2>Find your next event.</h2></div><span className="muted small">Only events created by coordinators appear here.</span></div>
      {loading ? <Spinner label="Loading public events" /> : events.length ? <div className="event-grid">{events.slice(0, 3).map((event) => <EventCard key={event.slug} event={event} onClick={() => onOpenEvent(event.slug)} />)}</div> : <EmptyState title="No public events yet" body="When a coordinator creates a public event, its invitation will appear here. You can also open a private event using its invite link." />}
    </section>
  </div>;
}

function EventCard({ event, onClick, compact = false }) {
  return <button className={`event-card ${compact ? 'event-card-compact' : ''}`} onClick={onClick}>
    <div className="event-card-top"><span className="category-tag">{event.category || 'Event'}</span><span className={`status-tag status-${event.status}`}>{event.status === 'active' ? 'Open' : event.status}</span></div>
    <h3>{event.name}</h3><p className="event-card-description">{event.description}</p>
    <EventDate event={event} />
    <div className="event-card-meta"><span><MapPin size={14} />{event.venueName}</span>{typeof event.memberCount === 'number' && <span><Users size={14} />{event.memberCount} joined</span>}</div>
    <span className="event-card-link">View event <ChevronRight size={16} /></span>
  </button>;
}

function AuthPage({ mode, setMode, onSubmit, loading, onBack }) {
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const register = mode === 'register';
  async function submit(event) {
    event.preventDefault(); setError('');
    try { await onSubmit(form, mode); } catch (e) { setError(e.message); }
  }
  return <div className="auth-wrap"><div className="auth-card">
    <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> Back</button>
    <div className="eyebrow">{register ? 'GET STARTED' : 'WELCOME BACK'}</div>
    <h1>{register ? 'Create your account.' : 'Good to see you again.'}</h1>
    <p className="muted">{register ? 'Join an event community first. Matching is always your choice.' : 'Sign in to continue to your events and connections. Coordinator access is provisioned by an authorized operator.'}</p>
    <Notice kind="error">{error}</Notice>
    <form onSubmit={submit} className="form-stack">
      {register && <><Field label="Your name" required><input autoComplete="name" maxLength="80" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <p className="muted small">New accounts join as attendees. Coordinator access is provisioned by an authorized operator.</p></>}
      <Field label="Email address" required><input type="email" autoComplete="email" maxLength="254" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
      <Field label="Password" hint={register ? 'Use at least 8 characters.' : ''} required><input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : 1} maxLength="128" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
      {register && <p className="dev-auth-note"><CircleAlert size={14} /> This local prototype uses development-only email verification. Do not use a real password.</p>}
      <Button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : null}{register ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></Button>
    </form>
    <p className="auth-switch">{register ? 'Already have an account?' : 'New to Meetups?'} <button className="text-button" onClick={() => { setError(''); setMode(register ? 'login' : 'register'); }}>{register ? 'Sign in' : 'Create an account'}</button></p>
  </div><div className="auth-side"><div className="auth-side-mark"><LockKeyhole size={20} /></div><blockquote>Your next event can start before you get there.</blockquote><p className="auth-side-foot">Meetups keeps the first hello private until both people are ready.</p></div></div>;
}

function ProfilePage({ user, onSave, onPrivacy, loading }) {
  const [form, setForm] = useState(() => ({
    name: user?.name || '', gender: user?.gender || '', city: user?.city || '', locality: user?.locality || '', bio: user?.bio || '',
    interests: (user?.interests || []).join(', '), profession: user?.profession || '', languages: (user?.languages || []).join(', '),
    matchGenders: normalizeMatchGenders(user?.matchGenders || []), visibility: user?.visibility || { city: true, bio: true, interests: true, profession: false, languages: true, gender: false },
  }));
  const [error, setError] = useState('');
  useEffect(() => {
    if (user) setForm({ name: user.name || '', gender: user.gender || '', city: user.city || '', locality: user.locality || '', bio: user.bio || '', interests: (user.interests || []).join(', '), profession: user.profession || '', languages: (user.languages || []).join(', '), matchGenders: normalizeMatchGenders(user.matchGenders || []), visibility: user.visibility || { city: true, bio: true, interests: true, profession: false, languages: true, gender: false } });
  }, [user]);
  async function submit(e) {
    e.preventDefault(); setError('');
    if (isLikelyDetailedAddress(form.locality)) { setError('Use a neighbourhood or area only; do not enter a home or street address.'); return; }
    try { await onSave({ ...form, interests: splitList(form.interests), languages: splitList(form.languages), matchGenders: normalizeMatchGenders(form.matchGenders) }); }
    catch (err) { setError(err.message); }
  }
  const toggleGender = (gender) => setForm((current) => ({ ...current, matchGenders: current.matchGenders.includes(gender) ? current.matchGenders.filter((item) => item !== gender) : [...current.matchGenders, gender] }));
  const toggleVisibility = (field) => setForm((current) => ({ ...current, visibility: { ...current.visibility, [field]: !current.visibility[field] } }));
  return <div className="page-wrap narrow-page"><PageTitle eyebrow="YOUR PROFILE" title="A little about you." description="You can join event communities first. Add gender and travel details only if you choose to opt into matching." />
    <Notice kind="error">{error}</Notice>
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-heading"><div><h2>Profile basics</h2><p>Name is enough to join. Gender, city and locality are optional unless you opt into matching.</p></div><span className="private-badge"><LockKeyhole size={13} /> Private until accepted</span></div>
      <div className="form-grid"><Field label="Name" required><input autoComplete="name" maxLength="80" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Gender" hint="Optional. Used only for matching and hidden by default."><select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">Not set</option>{genderOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="Current city" hint="Optional; needed only if you turn on matching."><input maxLength="100" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
        <Field label="Approximate locality" hint="Neighbourhood or area only. Never enter a home, street address or live location."><input maxLength="100" placeholder="For example, Kakkanad" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} /></Field>
        <Field label="Short introduction" className="field-full"><textarea rows="3" maxLength="240" placeholder="A little about what brings you to events." value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
        <Field label="Interests" hint="Separate with commas."><input maxLength="300" placeholder="Design, running, live music" value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} /></Field>
        <Field label="Profession or education"><input maxLength="80" value={form.profession} onChange={(e) => setForm({ ...form, profession: e.target.value })} /></Field>
        <Field label="Languages" hint="Separate with commas."><input maxLength="200" placeholder="English, Malayalam" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} /></Field>
      </div>
      <div className="form-divider" />
      <div className="panel-subheading"><h3>Who are you comfortable travelling with?</h3><p>Select each preference intentionally. An empty selection means matching stays off; nothing is selected for you.</p></div>
      <div className="choice-grid">{genderOptions.map(([value, label]) => <label className="check-choice" key={value}><input type="checkbox" checked={form.matchGenders.includes(value)} onChange={() => toggleGender(value)} /><span>{label}</span></label>)}</div>
      <p className="field-hint" role="status">{form.matchGenders.length ? `${form.matchGenders.length} matching ${form.matchGenders.length === 1 ? 'preference' : 'preferences'} selected.` : 'No matching preferences selected. Matching remains off until you choose at least one.'}</p>
      <div className="form-divider" />
      <div className="panel-subheading"><h3>Profile visibility after acceptance</h3><p>Your name is shown after acceptance. Choose which other profile fields to share. Email is never shown by this setting.</p></div>
      <div className="visibility-list">{[['city', 'City'], ['bio', 'Short introduction'], ['interests', 'Interests'], ['profession', 'Profession or education'], ['languages', 'Languages'], ['gender', 'Gender']].map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(form.visibility[key])} onChange={() => toggleVisibility(key)} /><span className="toggle-visual" aria-hidden="true" /></label>)}</div>
      <div className="form-actions"><Button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save profile</Button><span className="muted small">No exact address or live location is collected.</span></div>
    </form>
    <div className="profile-safety-link"><div><ShieldCheck size={17} /><span>Blocked accounts and safety settings</span></div><Button variant="outline" onClick={onPrivacy}>Manage <ArrowRight size={14} /></Button></div>
  </div>;
}

function TravelForm({ event, initial, user, onSave, loading }) {
  const existing = initial || {};
  const [form, setForm] = useState({
    city: existing.city || user?.city || '', locality: existing.locality || user?.locality || '',
    modes: existing.modes || [], travelDate: existing.travelDate || event.eventDate || '', departureTime: existing.departureTime || '',
    lookingForCompanion: Boolean(existing.lookingForCompanion), willingToShare: Boolean(existing.willingToShare), carIntent: existing.carIntent || '',
    seats: Number(existing.seats || 0), meetingPoint: existing.meetingPoint || '', details: existing.details || '',
  });
  const [error, setError] = useState('');
  const canMatch = Boolean(user?.gender && user?.matchGenders?.length);
  useEffect(() => setForm({ city: existing.city || user?.city || '', locality: existing.locality || user?.locality || '', modes: existing.modes || [], travelDate: existing.travelDate || event.eventDate || '', departureTime: existing.departureTime || '', lookingForCompanion: Boolean(existing.lookingForCompanion), willingToShare: Boolean(existing.willingToShare), carIntent: existing.carIntent || '', seats: Number(existing.seats || 0), meetingPoint: existing.meetingPoint || '', details: existing.details || '' }), [event.slug, initial, user?.city, user?.locality]);
  const toggleMode = (mode) => setForm((current) => ({ ...current, modes: current.modes.includes(mode) ? current.modes.filter((item) => item !== mode) : [...current.modes, mode] }));
  async function submit(e) {
    e.preventDefault(); setError('');
    if (isLikelyDetailedAddress(form.locality)) { setError('Use a neighbourhood or area only; do not enter a home or street address.'); return; }
    try { await onSave(event.slug, form); }
    catch (err) { setError(err.message); }
  }
  return <form className="travel-form" onSubmit={submit}>
    <Notice kind="error">{error}</Notice>
    <div className="form-grid"><Field label="Starting city" hint="Needed only if you turn on matching."><input maxLength="100" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
      <Field label="Approximate starting locality" hint="Neighbourhood or area only; never enter a home, street address or live location."><input maxLength="100" placeholder="For example, Edappally" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} /></Field>
      <Field label="Travel date" hint="Optional if you have not decided yet."><input type="date" value={form.travelDate} onChange={(e) => setForm({ ...form, travelDate: e.target.value })} /></Field>
      <Field label="Approximate departure time"><input type="time" value={form.departureTime} onChange={(e) => setForm({ ...form, departureTime: e.target.value })} /></Field>
    </div>
    <fieldset className="field-set"><legend>How might you travel? <span className="muted small">(required for matching)</span></legend><div className="choice-grid mode-choice-grid">{travelModes.map((mode) => { const Icon = modeIcon[mode]; return <label className="check-choice" key={mode}><input type="checkbox" checked={form.modes.includes(mode)} onChange={() => toggleMode(mode)} /><span>{Icon && <Icon size={14} />} {mode}</span></label>; })}</div></fieldset>
    {form.modes.includes('Car') && <div className="car-options"><div className="form-grid"><Field label="Car travel plan"><select value={form.carIntent} onChange={(e) => setForm({ ...form, carIntent: e.target.value, willingToShare: e.target.value === 'offering' })}><option value="">Choose an option</option><option value="offering">I can offer seats to share</option><option value="seeking">I'm looking for a ride</option><option value="not-sharing">I'm travelling by car, not sharing seats</option></select></Field>{form.carIntent === 'offering' && <Field label="Driver-reported seats" required hint="Seats aren’t reserved through Meetups; confirm availability and costs directly in chat."><input type="number" min="1" max="12" value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} required /></Field>}</div><p className="field-hint">A car is not treated as an offer unless you explicitly choose to share seats.</p></div>}
    <div className="form-divider" />
    <label className="matching-toggle"><span className="toggle-copy"><strong>I'm looking for a travel companion</strong><small>You can join the event community without turning this on.</small></span><input type="checkbox" checked={form.lookingForCompanion} disabled={!canMatch && !form.lookingForCompanion} onChange={(e) => setForm({ ...form, lookingForCompanion: e.target.checked })} /><span className="toggle-visual" aria-hidden="true" /></label>
    {!canMatch && !form.lookingForCompanion && <p className="field-hint matching-hint">Matching stays off until you add gender and intentionally select at least one matching preference in your profile.</p>}
    {form.lookingForCompanion && <div className="matching-explainer"><LockKeyhole size={15} /><span>Only compatible attendees from this event can find you. Your name stays hidden unless a request is accepted.</span></div>}
    <details className="optional-details"><summary>Optional travel details</summary><div className="form-grid details-grid"><Field label="Preferred meeting point"><input maxLength="160" placeholder="A public place near the venue" value={form.meetingPoint} onChange={(e) => setForm({ ...form, meetingPoint: e.target.value })} /></Field><Field label="Anything else to share"><input maxLength="300" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></Field></div></details>
    <div className="form-actions"><Button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save travel preferences</Button><span className="muted small">Travel plans can change at any time.</span></div>
  </form>;
}

function EventPage({ event, user, joined, travel, announcements, onJoin, onEditTravel, onMatches, onLeave, onBack, onAnnounce, isCoordinator, loading, onEditEvent, onCancelEvent }) {
  const [showTravel, setShowTravel] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [announceError, setAnnounceError] = useState('');
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  if (!event) return <Spinner label="Loading event details" />;
  async function publish(e) {
    e.preventDefault(); setAnnounceError('');
    try { await onAnnounce(event.slug, announceText); setAnnounceText(''); setShowAnnouncementForm(false); }
    catch (error) { setAnnounceError(error.message); }
  }
  return <div className="page-wrap">
    <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> All events</button>
    <div className="event-detail-layout"><main>
      <div className="event-detail-head"><span className="category-tag">{event.category}</span><span className={`status-tag status-${event.status}`}>{event.status === 'active' ? 'Open invitation' : event.status}</span></div>
      {event.status === 'cancelled' && <p className="matching-paused-note" role="status">{eventMatchingStatus(event, travel).label}.</p>}
      <h1 className="event-detail-title">{event.name}</h1><p className="event-lede">{event.description}</p>
      <div className="event-detail-facts"><div><CalendarDays size={17} /><div><strong>{dateLabel(event.eventDate)}</strong><span>{timeLabel(event.startTime)}{event.endTime ? ` – ${timeLabel(event.endTime)}` : ''}</span></div></div><div><MapPin size={17} /><div><strong>{event.venueName}</strong><span>{event.venueAddress}</span></div></div><div><Users size={17} /><div><strong>{event.memberCount} joined</strong><span>Attendees in the event community</span></div></div></div>
      <div className="event-organizer"><span className="avatar-dot">{(event.organizerName || 'O').slice(0, 1).toUpperCase()}</span><div><span className="eyebrow">ORGANIZED BY</span><strong>{event.organizerName}</strong></div>{event.mapUrl && <a className="text-link" href={event.mapUrl} target="_blank" rel="noreferrer">Map <ExternalLink size={14} /></a>}</div>
      {event.registrationLink && <a className="registration-link" href={event.registrationLink} target="_blank" rel="noreferrer">Event registration details <ExternalLink size={14} /></a>}
      {user && event.isOwner && <div className="owner-controls"><Button variant="outline" onClick={() => onEditEvent?.(event)}>Edit event</Button><Button variant="outline" disabled={event.status === 'cancelled'} onClick={() => onEditEvent?.(event, 'registration')}>{event.status === 'cancelled' ? 'Registration closed' : event.registrationOpen ? 'Close registration' : 'Open registration'}</Button>{event.status !== 'cancelled' && <Button variant="outline" onClick={() => onCancelEvent?.(event)}>Cancel event</Button>}</div>}
      {!user ? <div className="join-box"><div><h2>Join the event community</h2><p>Joining doesn't opt you into travel matching.</p></div><Button onClick={onJoin} disabled={!event.registrationOpen || event.status !== 'active'}>{event.registrationOpen ? 'Sign in to join' : 'Registration closed'} <ArrowRight size={16} /></Button></div>
        : !joined ? <div className="join-box"><div><h2>Join the event community</h2><p>Travel matching is optional and can be set up later.</p></div><Button onClick={onJoin} disabled={!event.registrationOpen || event.status !== 'active'}>{event.registrationOpen ? 'Join event' : 'Registration closed'} <ArrowRight size={16} /></Button></div>
          : <div className="community-panel"><div className="community-heading"><div className="community-icon"><Users size={18} /></div><div><h2>Event community</h2><p>You’re in. Your membership is separate from travel matching.</p></div><span className="joined-pill"><Check size={13} /> Joined</span></div>
            <div className="community-body"><div className="section-label-row"><div><h3>Coordinator announcements</h3><span className="muted small">Event updates from the organizer.</span></div>{isCoordinator && <Button variant="outline" onClick={() => setShowAnnouncementForm(!showAnnouncementForm)}><Plus size={15} /> New announcement</Button>}</div>
              {showAnnouncementForm && <form className="announcement-form" onSubmit={publish}><label className="sr-only" htmlFor="announcement-text">Announcement</label><textarea id="announcement-text" rows="3" value={announceText} onChange={(e) => setAnnounceText(e.target.value)} maxLength="1200" required placeholder="Share an update with attendees"/><Notice kind="error">{announceError}</Notice><Button type="submit" disabled={loading}>{loading ? 'Publishing…' : 'Publish announcement'}</Button></form>}
              {announcements.length ? <div className="announcement-list">{announcements.map((item) => <article className="announcement-item" key={item.id}><p>{item.body}</p><span>{item.authorName} · {new Date(item.createdAt).toLocaleDateString()}</span></article>)}</div> : <div className="inline-empty">No announcements yet.</div>}
            </div>
            <div className="community-separation"><div><strong>Travel companion matching</strong><span>Opt in only if you'd like to meet compatible attendees.</span></div><Button variant="outline" disabled={isMatchingActionDisabled(event)} onClick={() => setShowTravel(!showTravel)}>{event.status === 'cancelled' ? 'Matching paused' : showTravel ? 'Hide preferences' : travel?.lookingForCompanion ? 'Edit travel preferences' : 'Set travel preferences'} <ChevronDown size={15} /></Button></div>
            {showTravel && !isMatchingActionDisabled(event) && <div className="travel-form-wrap"><TravelForm event={event} initial={travel} user={user} onSave={onEditTravel} loading={loading} /></div>}
            {event.status === 'cancelled' ? <div className="matching-entry matching-paused-entry"><div><span>Matching paused for this event.</span></div><Button disabled={isMatchingActionDisabled(event)}>See compatible attendees <ArrowRight size={15} /></Button></div> : isEventMatchingEnabled(event, travel) ? <div className="matching-entry"><div><span className="active-dot" /><span>Travel matching is on for this event.</span></div><Button onClick={onMatches}>See compatible attendees <ArrowRight size={15} /></Button></div> : travel?.lookingForCompanion && event.status !== 'active' && <p className="field-hint matching-hint">Travel matching is unavailable because this event is {event.status}.</p>}
            <button className="text-button leave-link" onClick={onLeave}>Leave event community</button>
          </div>}
      {user && event.isOwner && !joined && <section className="community-panel owner-announcements"><div className="community-body"><div className="section-label-row"><div><h3>Event announcements</h3><span className="muted small">Updates are visible to the event owner and current members.</span></div><Button variant="outline" onClick={() => setShowAnnouncementForm(!showAnnouncementForm)}><Plus size={15} /> New announcement</Button></div>{showAnnouncementForm && <form className="announcement-form" onSubmit={publish}><label className="sr-only" htmlFor="owner-announcement-text">Announcement</label><textarea id="owner-announcement-text" rows="3" value={announceText} onChange={(e) => setAnnounceText(e.target.value)} maxLength="1200" required placeholder="Share an update with attendees"/><Notice kind="error">{announceError}</Notice><Button type="submit" disabled={loading}>{loading ? 'Publishing…' : 'Publish announcement'}</Button></form>}{announcements.length ? <div className="announcement-list">{announcements.map((item) => <article className="announcement-item" key={item.id}><p>{item.body}</p><span>{item.authorName} · {new Date(item.createdAt).toLocaleDateString()}</span></article>)}</div> : <div className="inline-empty">No announcements yet.</div>}</div></section>}
      {user && event.isOwner && <div className="owner-event-note"><ShieldCheck size={16} /><span>You’re the coordinator for this event. You can manage it without joining as an attendee.</span></div>}
    </main><aside className="event-aside"><div className="aside-note"><LockKeyhole size={18} /><h3>Your identity stays private.</h3><p>Before acceptance, people see only anonymous travel details. After acceptance, both names and the profile fields each person selected are revealed.</p></div><div className="aside-note plain"><h3>About travel plans</h3><p>Meetups helps attendees connect. It does not operate transport or guarantee a ride, seat or travel arrangement.</p></div><div className="aside-organizer"><span className="eyebrow">ORGANIZER</span><strong>{event.organizerName}</strong><span className="muted small">Contact details are not shared automatically.</span></div></aside></div>
  </div>;
}

function EventMatchingStatus({ event }) {
  const status = eventMatchingStatus(event);
  return <span className={status.enabled ? 'matching-on' : ''}>{status.label}</span>;
}

function EventsPage({ events, ownedEvents, loading, hasError, onLoadMore, nextOffset, onOpen, onBrowse, onCreate, user }) {
  const joined = events || [];
  return <div className="page-wrap"><PageTitle eyebrow="YOUR MEETUPS" title="My events" description="Your event community comes first. Travel matching is an optional extra, never a condition of joining." action={user?.role === 'coordinator' ? <Button onClick={onCreate}><Plus size={16} /> Create event</Button> : null} />
    <div className="dashboard-columns"><section><div className="section-label-row"><h2>Joined events</h2><span className="muted small">{joined.length} {joined.length === 1 ? 'event' : 'events'}</span></div>
      {loading ? <Spinner label="Loading your events" /> : joined.length ? <><div className="event-grid">{joined.map((event) => <div className="joined-event-wrap" key={event.slug}><EventCard event={event} onClick={() => onOpen(event.slug)} /><div className="joined-event-footer"><EventMatchingStatus event={event} /><button className="text-button" onClick={() => onOpen(event.slug)}>Open event <ChevronRight size={14} /></button></div></div>)}</div>{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more events</Button>}</> : !hasError && <EmptyState title="No events yet" body="Join an event using its invitation link, or explore public events to find one that fits." action={<Button variant="outline" onClick={onBrowse}>Explore events</Button>} />}
      </section><aside className="dashboard-rail"><div className="rail-card"><div className="rail-icon"><LockKeyhole size={18} /></div><h3>Matching is always optional</h3><p>Join the community first. Only turn on travel matching if you want to find a companion.</p><button className="text-button" onClick={() => joined[0] ? onOpen(joined[0].slug) : onBrowse()}>{joined.length ? 'How matching works' : 'Explore events'} <ArrowRight size={14} /></button></div>
        {user?.role === 'coordinator' && <div className="rail-card rail-card-warm"><span className="eyebrow">HOSTING AN EVENT?</span><h3>Bring your attendees together.</h3><p>Create an invitation link and let people join on their own terms.</p><Button variant="outline" onClick={onCreate}><Plus size={15} /> Create event</Button></div>}
        {ownedEvents?.length > 0 && <div className="rail-card"><div className="eyebrow">COORDINATOR</div><h3>Your event dashboard</h3><p>Manage events, privacy-protected travel summaries and announcements.</p><button className="text-button" onClick={() => onCreate('dashboard')}>Open dashboard <ArrowRight size={14} /></button></div>}
      </aside></div>
  </div>;
}

function BrowseEventsPage({ events, onOpen, loading, hasError, onLoadMore, nextOffset }) {
  const publicEvents = events.filter((event) => event.visibility === 'public');
  return <div className="page-wrap"><PageTitle eyebrow="PUBLIC INVITATIONS" title="Explore events." description="These are public invitations created by event coordinators. Private events are available only through their invitation link." />
    {loading ? <Spinner label="Loading public events" /> : publicEvents.length ? <><div className="event-grid">{publicEvents.map((event) => <EventCard key={event.slug} event={event} onClick={() => onOpen(event.slug)} />)}</div>{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more events</Button>}</> : !hasError && <EmptyState title="No public events yet" body="Public event invitations will appear here when coordinators create them. You can still join a private event from its invite link." />}
  </div>;
}

function DiscoveryPage({ events, slug, setSlug, matches, loading, error, onSend, onBlock, onReport, onOpenEvent, message, hasError, nextOffset, onLoadMore }) {
  const eligibleEvents = events.filter((event) => isEventMatchingEnabled(event));
  return <div className="page-wrap"><PageTitle eyebrow="TRAVEL MATCHING" title="Find someone going your way." description="Recommendations come only from real attendees of the same event. Names and profiles stay hidden until the recipient accepts." action={eligibleEvents.length > 0 && <Field label="Event"><select className="header-select" value={slug || eligibleEvents[0]?.slug || ''} onChange={(e) => setSlug(e.target.value)}>{eligibleEvents.map((event) => <option key={event.slug} value={event.slug}>{event.name}</option>)}</select></Field>} />
    <div className="privacy-banner"><LockKeyhole size={17} /><div><strong>Anonymous until acceptance</strong><span>Both people’s travel and gender preferences must allow a recommendation. We do not fill the list with incompatible or invented matches.</span></div></div>
    {!eligibleEvents.length ? !loading && !hasError && <EmptyState title="Matching is off for your events" body="Open an event, save travel preferences and choose “I'm looking for a travel companion.” You can still use the event community without matching." action={<Button variant="outline" onClick={() => onOpenEvent(events[0]?.slug)}>View my events</Button>} />
      : loading ? <Spinner label="Checking for compatible attendees" />
        : matches.length ? <><div className="match-grid">{matches.map((match, index) => <article className="match-card" key={match.userRef}><div className="match-card-head"><div className="anonymous-avatar"><LockKeyhole size={18} /></div><span className="anonymous-label">ANONYMOUS MATCH</span><span className="match-number">{String(index + 1).padStart(2, '0')}</span></div><h2>{match.alias}</h2><p className="match-event"><CalendarDays size={14} />{match.eventName}</p><div className="match-facts"><div><MapPin size={15} /><span>{match.approximateLocality ? `${match.approximateLocality}, ` : ''}{match.city}</span></div><div><ModePills modes={match.modes} /></div>{match.seatsOffered && <div><Car size={14} /><span>Driver-reported seats: {match.seatsOffered}</span></div>}{match.travelDate && <div><CalendarDays size={14} /><span>Travelling {dateLabel(match.travelDate)}</span></div>}{match.departureTime && <div><span className="fact-spacer" /><span>Around {timeLabel(match.departureTime)}</span></div>}</div><div className="compatibility-reasons"><span className="eyebrow">WHY THIS COULD FIT</span>{match.reasons.map((reason) => <span className="reason-line" key={reason}><Check size={13} />{reason}</span>)}</div><div className="match-card-actions"><Button onClick={() => onSend(match)}>Send travel request <ArrowRight size={15} /></Button><button className="text-button safety-action" onClick={() => onReport(match)}>Report</button><button className="text-button safety-action" onClick={() => onBlock(match)}>Block</button></div></article>)}</div>{matches.some((match) => match.seatsOffered > 0) && <p className="seat-disclaimer">Seats aren’t reserved through Meetups; confirm availability and costs directly in chat.</p>}{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Check more attendees</Button>}</>
          : !hasError && <EmptyState title={nextOffset != null ? 'No compatible attendees on this page' : 'No compatible attendees yet'} body={message || 'There are no real event attendees who meet both people’s preferences and travel requirements yet. Check back if plans change.'} action={nextOffset != null ? <Button variant="outline" onClick={onLoadMore}>Check more attendees</Button> : slug && <Button variant="outline" onClick={() => onOpenEvent(slug)}>Review travel preferences</Button>} />}
  </div>;
}

function RequestsPage({ requests, loading, hasError, nextOffset, onLoadMore, onAccept, onDecline, onCancel, onBlock, onReport, message }) {
  const [tab, setTab] = useState('incoming');
  const list = tab === 'incoming' ? requests.incoming : requests.outgoing;
  return <div className="page-wrap"><PageTitle eyebrow="REQUESTS" title="A first hello, privately." description="Requests do not reveal names or contact details. Declines, cancellations and blocks remain anonymous." />
    <Notice>{message}</Notice>
    <div className="tabs" role="tablist" aria-label="Travel requests"><button role="tab" aria-selected={tab === 'incoming'} className={tab === 'incoming' ? 'tab-active' : ''} onClick={() => setTab('incoming')}>Incoming <span>{requests.pendingIncomingCount ?? requests.incoming.filter((item) => item.status === 'pending').length}</span></button><button role="tab" aria-selected={tab === 'outgoing'} className={tab === 'outgoing' ? 'tab-active' : ''} onClick={() => setTab('outgoing')}>Outgoing <span>{requests.outgoing.filter((item) => item.status === 'pending').length}</span></button></div>
    {loading ? <Spinner label="Loading requests" /> : list.length ? <><div className="request-list">{list.map((item) => <article className="request-card" key={item.id}><div className="request-card-avatar"><LockKeyhole size={16} /></div><div className="request-main"><div className="request-title-row"><div><span className="eyebrow">{tab === 'incoming' ? 'ANONYMOUS REQUEST' : 'YOUR REQUEST'}</span><h2>{item.alias}</h2></div><span className={`request-status status-${item.status}`}>{item.status}</span></div><p className="request-context">{item.eventName} · from {item.approximateLocality ? `${item.approximateLocality}, ` : ''}{item.city || 'a private attendee'}</p><ModePills modes={item.modes} />{item.travelDate && <span className="muted small">Travel date: {dateLabel(item.travelDate)}</span>}
          {item.status === 'pending' && tab === 'incoming' && <div className="recipient-consent"><LockKeyhole size={14} /><span><strong>{consentPolicy.statusLabel}.</strong> {consentPolicy.recipientDisclosure}</span></div>}
          {item.status === 'pending' && <div className="request-actions">{tab === 'incoming' ? <><Button onClick={() => onAccept(item)}><Check size={15} /> {consentPolicy.recipientAction}</Button><Button variant="outline" onClick={() => onDecline(item)}>Decline</Button></> : <Button variant="outline" onClick={() => onCancel(item)}>Cancel request</Button>}<button className="text-button safety-action" onClick={() => onReport(item)}>Report</button><button className="text-button safety-action" onClick={() => onBlock(item)}>Block</button></div>}
        </div></article>)}</div>{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more requests</Button>}</> : !hasError && <EmptyState title={tab === 'incoming' ? 'No incoming requests' : 'No outgoing requests'} body={tab === 'incoming' ? 'When an attendee sends a request, it will appear here without their identity.' : 'When you request to connect with a compatible attendee, its status will appear here.'} action={nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more requests</Button>} />}
  </div>;
}

function ConnectionsPage({ connections, selected, setSelected, messages, onOpenChat, onSendMessage, onBlock, onReport, onDisconnect, loading, hasError, nextOffset, onLoadMore, messagesNextOffset, onLoadEarlier, chatLoading, message }) {
  const [text, setText] = useState('');
  const connection = connections.find((item) => item.id === selected) || null;
  async function send(e) { e.preventDefault(); if (!text.trim()) return; await onSendMessage(connection.id, text); setText(''); }
  return <div className="page-wrap"><PageTitle eyebrow="ACCEPTED CONNECTIONS" title="Now you can say hello." description="Only accepted connections appear here. Chat and approved profile details are protected by the server." />
    <Notice>{message}</Notice>
    {loading ? <Spinner label="Loading connections" /> : connections.length ? <div className="connections-layout"><div className="connection-list">{connections.map((item) => <button key={item.id} className={`connection-list-item ${selected === item.id ? 'selected' : ''}`} onClick={() => onOpenChat(item)}><span className="connection-avatar">{item.profile.name.slice(0, 1).toUpperCase()}</span><span className="connection-item-copy"><strong>{item.profile.name}</strong><small>{item.eventName}</small></span>{item.unreadCount > 0 && <span className="unread-dot" aria-label={`${item.unreadCount} unread messages`} />}</button>)}{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more connections</Button>}</div>
      {connection ? <section className="chat-panel"><div className="chat-header"><div><div className="eyebrow">ACCEPTED CONNECTION · {connection.eventName}</div><h2>{connection.profile.name}</h2>{connection.profile.city && <span className="muted small">{connection.profile.city}</span>}</div><div className="chat-header-actions"><button className="text-button safety-action" onClick={() => onReport(connection)}>Report</button><button className="text-button safety-action" onClick={() => onBlock(connection)}>Block</button><button className="text-button safety-action" onClick={() => onDisconnect(connection)}>Disconnect</button></div></div>
        <div className="approved-profile"><div className="eyebrow">PROFILE DETAILS THEY CHOSE TO SHARE</div>{connection.profile.bio && <p>{connection.profile.bio}</p>}{connection.profile.interests?.length > 0 && <div className="profile-tags">{connection.profile.interests.map((item) => <span key={item}>{item}</span>)}</div>}{connection.profile.profession && <span className="muted small">{connection.profile.profession}</span>}{connection.profile.languages?.length > 0 && <span className="muted small">Languages: {connection.profile.languages.join(', ')}</span>}{connection.profile.gender && <span className="muted small">{genderOptions.find(([value]) => value === connection.profile.gender)?.[1]}</span>}{!connection.profile.bio && !connection.profile.interests?.length && !connection.profile.profession && !connection.profile.languages?.length && !connection.profile.gender && <span className="muted small">They haven't added other shareable profile details.</span>}</div>
        {messagesNextOffset != null && <Button variant="outline" onClick={onLoadEarlier}>Load earlier messages</Button>}<div className="chat-messages" aria-live="polite">{chatLoading ? <Spinner label="Loading messages" /> : messages.length ? messages.map((item) => <div key={item.id} className={`chat-message ${item.fromMe ? 'mine' : ''}`}><p>{item.body}</p><span>{new Date(item.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}{item.fromMe && item.readAt ? ' · Seen' : ''}</span></div>) : <div className="chat-empty"><MessageCircle size={19} /><p>This is the start of your conversation. Say hello and coordinate your plans.</p></div>}</div>
        <form className="chat-compose" onSubmit={send}><label className="sr-only" htmlFor="chat-input">Message</label><input id="chat-input" maxLength="2000" placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} /><Button type="submit" disabled={!text.trim()} aria-label="Send message"><Send size={16} /></Button></form>
      </section> : <div className="chat-placeholder"><MessageCircle size={22} /><h3>Choose a connection</h3><p>Profile details and chat are available only after acceptance.</p></div>}</div> : !hasError && <EmptyState title="No accepted connections yet" body="Once both attendees agree to connect, their chosen profile details and a private chat will appear here." />}
  </div>;
}

function ModerationPage({ reports, selectedReport, onOpen, onStatusChange, loading, nextOffset, onLoadMore }) {
  return <div className="page-wrap moderation-wrap"><PageTitle eyebrow="TRUST & SAFETY" title="Report review" description="Only provisioned moderators can see these reports. Opening a report and changing its status are recorded in the audit log." />
    {loading ? <Spinner label="Loading reports" /> : <div className="moderation-layout"><section className="panel moderation-list"><h2>Reports</h2>{reports.length ? reports.map((report) => <button className={`moderation-list-item ${selectedReport?.id === report.id ? 'selected' : ''}`} key={report.id} onClick={() => onOpen(report.id)}><span className={`request-status status-${report.status}`}>{report.status}</span><strong>{report.reason}</strong><span>{report.eventName || 'No event context'}</span><small>{report.reporterName} reported {report.targetName} · {new Date(report.createdAt).toLocaleDateString()}</small></button>) : <div className="inline-empty">No reports need review.</div>}{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more reports</Button>}</section>
      <section className="panel moderation-detail">{selectedReport ? <><div className="moderation-detail-head"><div><span className="eyebrow">REPORT DETAILS</span><h2>{selectedReport.reason}</h2></div><span className={`request-status status-${selectedReport.status}`}>{selectedReport.status}</span></div><dl><div><dt>Reporter</dt><dd>{selectedReport.reporterName}</dd></div><div><dt>Reported attendee</dt><dd>{selectedReport.targetName}</dd></div><div><dt>Event</dt><dd>{selectedReport.eventName || 'No event context'}</dd></div><div><dt>Submitted</dt><dd>{new Date(selectedReport.createdAt).toLocaleString()}</dd></div></dl><div className="moderation-context"><h3>What the moderator should know</h3><p>{selectedReport.details || 'No additional details were provided.'}</p></div>{selectedReport.status === 'open' && <Button onClick={() => onStatusChange(selectedReport.id, 'reviewing')}>Mark as reviewing</Button>}{selectedReport.status === 'reviewing' && <Button onClick={() => onStatusChange(selectedReport.id, 'resolved')}>Mark resolved</Button>}{selectedReport.status === 'resolved' && <p className="muted small">This report is resolved. Its status cannot be reopened in this workflow.</p>}</> : <EmptyState title="Select a report" body="Report content and identities are disclosed only in this moderator workspace." />}</section></div>}
  </div>;
}

function PrivacyPage({ user, onSave, blocks, onUnblock }) {
  const [form, setForm] = useState(user?.visibility || {});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => setForm(user?.visibility || {}), [user]);
  async function save(e) { e.preventDefault(); setError(''); setSuccess(''); try { await onSave(form); setSuccess('Privacy settings saved.'); } catch (err) { setError(err.message); } }
  return <div className="page-wrap narrow-page"><PageTitle eyebrow="SETTINGS & PRIVACY" title="Your privacy, your call." description="Choose which profile details to share after a connection is accepted. Your email and phone are never shown to other attendees." />
    <form className="panel privacy-panel" onSubmit={save}><div className="panel-heading"><div><h2>Share after acceptance</h2><p>Your name is shown once accepted. Everything below is optional.</p></div><LockKeyhole size={18} /></div>
      <div className="visibility-list">{[['city', 'City'], ['bio', 'Short introduction'], ['interests', 'Interests'], ['profession', 'Profession or education'], ['languages', 'Languages'], ['gender', 'Gender']].map(([key, label]) => <label className="toggle-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(form[key])} onChange={() => setForm({ ...form, [key]: !form[key] })} /><span className="toggle-visual" aria-hidden="true" /></label>)}</div>
      <Notice kind="error">{error}</Notice><Notice>{success}</Notice><div className="form-actions"><Button type="submit">Save privacy settings</Button></div>
    </form>
    <div className="privacy-callout"><ShieldCheck size={19} /><div><strong>Before acceptance, identity fields are not sent to other attendees.</strong><p>Matching uses your gender and stated preferences on the server. Gender is hidden by default and your exact home address and live location are not collected.</p></div></div>
    <section className="panel blocked-panel"><div className="panel-heading"><div><h2>Blocked accounts</h2><p>Blocked attendees are removed from matching and cannot continue requests or chat.</p></div></div>{blocks.length ? blocks.map((block) => <div className="blocked-row" key={block.id}><span>Blocked account · {new Date(block.createdAt).toLocaleDateString()}</span><button className="text-button" onClick={() => onUnblock(block.id)}>Unblock</button></div>) : <div className="inline-empty">No blocked accounts.</div>}</section>
  </div>;
}

function CoordinatorPage({ dashboard, onCreate, onOpenEvent, onCopyLink, copyLabel, onEditEvent, onToggleRegistration, onCancelEvent, loading, nextOffset, onLoadMore }) {
  return <div className="page-wrap coordinator-wrap"><PageTitle eyebrow="COORDINATOR DESK" title="Your events, at a glance." description="See registered attendee names separately from privacy-thresholded city and travel summaries. Individual preferences and profile details are not shown." action={<Button onClick={onCreate}><Plus size={16} /> Create event</Button>} />
    {loading ? <Spinner label="Loading your coordinator desk" /> : dashboard.length ? <div className="coordinator-events">{dashboard.map(({ event, attendees = [], aggregates, announcements }) => <section className="panel coordinator-event" key={event.slug}><div className="coordinator-event-head"><div><div className="event-card-top"><span className="category-tag">{event.category}</span><span className={`status-tag status-${event.status}`}>{event.status}</span></div><h2>{event.name}</h2><EventDate event={event} /><p className="muted small"><MapPin size={13} /> {event.venueName} · {event.venueAddress}</p></div><div className="coordinator-actions"><Button variant="outline" onClick={() => onCopyLink(event.slug)}><Copy size={15} /> {copyLabel === event.slug ? 'Copied' : 'Copy invite link'}</Button><Button variant="outline" onClick={() => onOpenEvent(event.slug)}>Open event</Button><Button variant="outline" onClick={() => onEditEvent(event)}>Edit event</Button><Button variant="outline" disabled={event.status === 'cancelled'} onClick={() => onToggleRegistration(event)}>{event.status === 'cancelled' ? 'Registration closed' : event.registrationOpen ? 'Close registration' : 'Open registration'}</Button>{event.status !== 'cancelled' && <Button variant="outline" onClick={() => onCancelEvent(event)}>Cancel event</Button>}</div></div>
      <div className="coord-stats"><div><strong>{event.memberCount}</strong><span>Joined attendees</span></div><div><strong>{aggregates.suppressed ? '—' : Object.keys(aggregates.byCity).length}</strong><span>Cities represented</span></div><div><strong>{announcements}</strong><span>Published updates</span></div></div>
      {aggregates.suppressed && <p className="field-hint aggregate-privacy-note">City and travel summaries appear only when at least five people are in the group.</p>}
      <div className="coord-breakdown"><div><h3>Attendees by city</h3>{Object.keys(aggregates.byCity).length ? <div className="aggregate-list">{Object.entries(aggregates.byCity).map(([city, count]) => <div key={city}><span>{city}</span><strong>{count}</strong></div>)}</div> : <p className="muted small">No city group is large enough to display yet.</p>}</div><div><h3>Travel modes</h3>{Object.keys(aggregates.byMode).length ? <div className="aggregate-list">{Object.entries(aggregates.byMode).map(([mode, count]) => <div key={mode}><span>{mode}</span><strong>{count}</strong></div>)}</div> : <p className="muted small">No travel-mode group is large enough to display yet.</p>}</div></div>
      <div className="coord-attendees"><h3>Registered attendees</h3>{attendees.length ? <ul className="coord-attendee-list">{attendees.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul> : <p className="muted small">No registered attendees yet.</p>}</div>
    </section>)}{nextOffset != null && <Button variant="outline" onClick={onLoadMore}>Load more events</Button>}</div> : <EmptyState title="No events to manage yet" body="Create an event to generate its invitation link. Privacy-protected attendee summaries appear only when group sizes are large enough." action={<Button onClick={onCreate}><Plus size={15} /> Create event</Button>} />}
  </div>;
}

function CreateEventPage({ user, onCreate, onUpdate, event, loading, onBack }) {
  const localDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const blankForm = { name: '', description: '', category: '', venueName: '', venueAddress: '', mapUrl: '', eventDate: localDate, startTime: '09:00', endTime: '', registrationLink: '', capacity: '', visibility: 'public', organizerName: user?.name || '', organizerContact: '' };
  const [form, setForm] = useState(() => event ? { ...blankForm, ...event, capacity: event.capacity ?? '', organizerContact: '' } : blankForm);
  const [error, setError] = useState('');
  useEffect(() => { if (event) setForm({ ...blankForm, ...event, capacity: event.capacity ?? '', organizerContact: '' }); }, [event?.slug]);
  async function submit(e) { e.preventDefault(); setError(''); try { const values = { ...form, capacity: form.capacity ? Number(form.capacity) : null }; if (event) { delete values.organizerContact; await onUpdate(event.slug, values); } else await onCreate(values); } catch (err) { setError(err.message); } }
  return <div className="page-wrap narrow-page"><button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> Coordinator desk</button><PageTitle eyebrow={event ? 'EDIT EVENT' : 'NEW EVENT'} title={event ? 'Update this invitation.' : 'Create an invitation.'} description="Required event details become visible to people who open the invite. Your organizer contact stays private." />
    <Notice kind="error">{error}</Notice><form className="panel form-panel" onSubmit={submit}>
      <div className="form-grid"><Field label="Event name" required><input maxLength="120" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field><Field label="Category" required><input maxLength="80" placeholder="Technology, arts, community…" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /></Field>
        <Field label="Description" className="field-full" required><textarea rows="4" maxLength="3000" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></Field>
        <Field label="Venue name" required><input maxLength="160" value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} required /></Field><Field label="Venue address" required><input maxLength="300" value={form.venueAddress} onChange={(e) => setForm({ ...form, venueAddress: e.target.value })} required /></Field>
        <Field label="Map link" hint="Use a public map URL, not a personal location." required><input type="url" maxLength="500" value={form.mapUrl} onChange={(e) => setForm({ ...form, mapUrl: e.target.value })} required /></Field><Field label="Event date" required><input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} required /></Field>
        <Field label="Start time" required><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required /></Field><Field label="End time"><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></Field>
        <Field label="Organizer name" required><input maxLength="100" value={form.organizerName} onChange={(e) => setForm({ ...form, organizerName: e.target.value })} required /></Field><Field label="Registration link"><input type="url" maxLength="500" value={form.registrationLink} onChange={(e) => setForm({ ...form, registrationLink: e.target.value })} /></Field>
        <Field label="Maximum attendees"><input type="number" min="1" max="100000" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field><Field label="Visibility"><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="public">Public</option><option value="private">Private invite link</option></select></Field>
        <Field label="Organizer contact" className="field-full" hint="Stored privately; it is never automatically shown to attendees."><input maxLength="200" value={form.organizerContact} onChange={(e) => setForm({ ...form, organizerContact: e.target.value })} /></Field>
      </div><div className="form-actions"><Button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : event ? <Check size={16} /> : <Plus size={16} />}{event ? 'Save event changes' : 'Create event and invite link'}</Button></div>
    </form>
  </div>;
}

export default function App() {
  const pathAtLoad = window.location.pathname;
  const pathEvent = pathAtLoad.match(/^\/event\/([^/]+)/);
  const [route, setRoute] = useState(pathEvent ? { screen: 'event', slug: decodeURIComponent(pathEvent[1]) } : { screen: 'landing' });
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authReturnSlug, setAuthReturnSlug] = useState('');
  const [events, setEvents] = useState([]);
  const [eventsNextOffset, setEventsNextOffset] = useState(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [myEvents, setMyEvents] = useState([]);
  const [ownedEvents, setOwnedEvents] = useState([]);
  const [myEventsNextOffset, setMyEventsNextOffset] = useState(null);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [matches, setMatches] = useState([]);
  const [matchesNextOffset, setMatchesNextOffset] = useState(null);
  const [matchMessage, setMatchMessage] = useState('');
  const [discoverSlug, setDiscoverSlug] = useState('');
  const [requests, setRequests] = useState({ incoming: [], outgoing: [], pendingIncomingCount: 0 });
  const [requestsNextOffset, setRequestsNextOffset] = useState(null);
  const [connections, setConnections] = useState([]);
  const [connectionsNextOffset, setConnectionsNextOffset] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesNextOffset, setMessagesNextOffset] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [coordinatorEvents, setCoordinatorEvents] = useState([]);
  const [coordinatorNextOffset, setCoordinatorNextOffset] = useState(null);
  const [moderationReports, setModerationReports] = useState([]);
  const [moderationNextOffset, setModerationNextOffset] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [pendingMatch, setPendingMatch] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState('safety');
  const [reportDetails, setReportDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [myEventsLoading, setMyEventsLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const [copiedSlug, setCopiedSlug] = useState('');
  const [requestTab, setRequestTab] = useState('incoming');
  const authGeneration = useRef(0);
  const mobileMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileNavWasOpen = useRef(false);

  const isEventRoute = route.screen === 'event' && route.slug;
  const activeSlug = isEventRoute ? route.slug : (route.screen === 'discovery' ? discoverSlug : '');
  const ownEvent = useMemo(() => myEvents.find((item) => item.slug === activeSlug), [myEvents, activeSlug]);
  const currentTravel = ownEvent?.travel || EMPTY_TRAVEL;
  const activeConnection = connections.find((item) => item.id === selectedConnection);

  function setRouteTo(next) {
    if (next.screen === 'event') window.history.pushState({}, '', `/event/${encodeURIComponent(next.slug)}`);
    else window.history.pushState({}, '', '/');
    setRoute(next); setPageError(''); setNotice(''); setMobileNavOpen(false);
  }
  function navigate(screen) {
    if (screen === 'coordinator' && user?.role !== 'coordinator') { setAuthMode('login'); setRouteTo({ screen: 'auth' }); return; }
    setRouteTo({ screen });
  }
  async function loadEvents(offset = 0, append = false, generation = authGeneration.current) {
    if (!append) setEventsLoading(true);
    try {
      const data = await api(`/api/events?limit=20&offset=${offset}`);
      if (generation === authGeneration.current) {
        setEvents((current) => append ? [...current, ...(data.events || [])] : (data.events || []));
        setEventsNextOffset(data.nextOffset ?? null);
      }
    } finally { if (!append && generation === authGeneration.current) setEventsLoading(false); }
  }
  async function loadMine(offset = 0, append = false) {
    if (!user) { setMyEvents([]); setOwnedEvents([]); setMyEventsLoading(false); return; }
    const generation = authGeneration.current;
    const ownerId = user.id;
    if (!append) setMyEventsLoading(true);
    try {
      const data = await api(`/api/my/events?limit=20&offset=${offset}`);
      if (!isCurrentAuthResponse(generation, authGeneration.current, ownerId, user?.id)) return data;
      setMyEvents((current) => append ? [...current, ...(data.events || [])] : (data.events || []));
      setOwnedEvents((current) => append ? [...current, ...(data.ownedEvents || [])] : (data.ownedEvents || []));
      setMyEventsNextOffset(data.nextOffset ?? null);
      return data;
    } finally { if (!append && isCurrentAuthResponse(generation, authGeneration.current, ownerId, user?.id)) setMyEventsLoading(false); }
  }
  async function loadRequests(offset = 0, append = false) {
    const generation = authGeneration.current;
    const ownerId = user?.id;
    const data = await api(`/api/requests?limit=20&offset=${offset}`);
    if (!isCurrentAuthResponse(generation, authGeneration.current, ownerId, user?.id)) return data;
    setRequests((current) => append ? { incoming: [...current.incoming, ...(data.incoming || [])], outgoing: [...current.outgoing, ...(data.outgoing || [])], pendingIncomingCount: data.pendingIncomingCount || 0 } : data);
    setRequestsNextOffset(data.nextOffset ?? null);
    return data;
  }
  async function loadConnections(offset = 0, append = false) {
    const generation = authGeneration.current;
    const ownerId = user?.id;
    const data = await api(`/api/connections?limit=20&offset=${offset}`);
    if (!isCurrentAuthResponse(generation, authGeneration.current, ownerId, user?.id)) return data;
    setConnections((current) => append ? [...current, ...(data.connections || [])] : (data.connections || []));
    setConnectionsNextOffset(data.nextOffset ?? null);
    return data;
  }
  async function loadMessages(connectionId, offset = 0, append = false) {
    const generation = authGeneration.current;
    const ownerId = user?.id;
    const data = await api(`/api/connections/${connectionId}/messages?limit=30&offset=${offset}`);
    if (!isCurrentAuthResponse(generation, authGeneration.current, ownerId, user?.id)) return data;
    setMessages((current) => append ? [...(data.messages || []), ...current] : (data.messages || []));
    setMessagesNextOffset(data.nextOffset ?? null);
    return data;
  }
  async function refreshAll() {
    await loadEvents();
    if (user) await loadMine();
  }
  useEffect(() => {
    api('/api/me').then(({ user: current }) => setUser(current)).catch(() => setUser(null)).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => {
    const generation = ++authGeneration.current;
    setEvents([]);
    loadEvents(0, false, generation).catch((e) => { if (isCurrentAuthResponse(generation, authGeneration.current, user?.id, user?.id)) setPageError(e.message); });
  }, [user]);
  useEffect(() => {
    if (!user) { setMyEvents([]); setOwnedEvents([]); return; }
    const generation = authGeneration.current;
    const ownerId = user.id;
    loadMine().catch((e) => { if (isCurrentAuthResponse(generation, authGeneration.current, ownerId, user?.id)) setPageError(e.message); });
  }, [user]);
  useEffect(() => {
    if (route.screen !== 'event' || !route.slug) { setCurrentEvent(null); setAnnouncements([]); return; }
    let alive = true; setPageLoading(true); setPageError(''); setCurrentEvent(null); setAnnouncements([]);
    (async () => {
      try {
        const eventData = await api(`/api/events/${encodeURIComponent(route.slug)}`);
        if (!alive) return;
        setCurrentEvent(eventData.event);
        if (user && (eventData.event.isMember || eventData.event.isOwner)) {
          const annData = await api(`/api/events/${encodeURIComponent(route.slug)}/announcements?limit=20&offset=0`);
          if (alive) setAnnouncements(annData.announcements || []);
        }
      } catch (e) { if (alive) setPageError(e.message); }
      finally { if (alive) setPageLoading(false); }
    })();
    return () => { alive = false; };
  }, [route.screen, route.slug, user]);
  useEffect(() => {
    if (route.screen === 'discovery') {
      const selectedEvent = myEvents.find((item) => item.slug === discoverSlug);
      if (!isEventMatchingEnabled(selectedEvent)) {
        const nextMatchEvent = myEvents.find((item) => isEventMatchingEnabled(item));
        const nextSlug = nextMatchEvent?.slug || '';
        if (nextSlug !== discoverSlug) setDiscoverSlug(nextSlug);
      }
    }
  }, [route.screen, discoverSlug, myEvents]);
  useEffect(() => {
    if (route.screen !== 'discovery' || !discoverSlug || !user) return;
    let alive = true; setPageLoading(true); setPageError('');
    setMatchesNextOffset(null);
    api(`/api/events/${encodeURIComponent(discoverSlug)}/matches?limit=25&offset=0`).then((data) => { if (alive) { setMatches(data.matches || []); setMatchesNextOffset(data.nextOffset ?? null); setMatchMessage(data.message || ''); } }).catch((e) => { if (alive) { setMatches([]); setPageError(e.message); } }).finally(() => alive && setPageLoading(false));
    return () => { alive = false; };
  }, [route.screen, discoverSlug, user]);
  useEffect(() => {
    if (!user) { setRequests({ incoming: [], outgoing: [], pendingIncomingCount: 0 }); setRequestsNextOffset(null); return; }
    let alive = true;
    api('/api/requests?limit=20&offset=0').then((data) => { if (alive) { setRequests(data); setRequestsNextOffset(data.nextOffset ?? null); } }).catch((e) => alive && setPageError(e.message));
    return () => { alive = false; };
  }, [user]);
  useEffect(() => {
    if (route.screen !== 'requests' || !user) return;
    let alive = true; setPageLoading(true); setPageError('');
    loadRequests().catch((e) => alive && setPageError(e.message)).finally(() => alive && setPageLoading(false));
    return () => { alive = false; };
  }, [route.screen, user]);
  useEffect(() => {
    if (route.screen !== 'connections' || !user) return;
    let alive = true; setPageLoading(true); setPageError('');
    loadConnections().then((data) => { if (alive && !selectedConnection && data.connections?.[0]) setSelectedConnection(data.connections[0].id); }).catch((e) => alive && setPageError(e.message)).finally(() => alive && setPageLoading(false));
    return () => { alive = false; };
  }, [route.screen, user]);
  useEffect(() => {
    if (route.screen !== 'connections' || !selectedConnection || !user) { setMessages([]); return; }
    let alive = true; setChatLoading(true);
    loadMessages(selectedConnection).catch((e) => alive && setPageError(e.message)).finally(() => alive && setChatLoading(false));
    return () => { alive = false; };
  }, [route.screen, selectedConnection, user]);
  useEffect(() => {
    if (route.screen !== 'privacy' || !user) return;
    let alive = true;
    api('/api/blocks').then((data) => { if (alive) setBlocks(data.blocks || []); }).catch((e) => { if (alive) setPageError(e.message); });
    return () => { alive = false; };
  }, [route.screen, user]);
  useEffect(() => {
    if (route.screen !== 'coordinator' || !user || user.role !== 'coordinator') return;
    let alive = true; setPageLoading(true);
    api('/api/coordinator/dashboard?limit=20&offset=0').then((data) => { if (alive) { setCoordinatorEvents(data.events || []); setCoordinatorNextOffset(data.nextOffset ?? null); } }).catch((e) => alive && setPageError(e.message)).finally(() => alive && setPageLoading(false));
    return () => { alive = false; };
  }, [route.screen, user]);
  useEffect(() => {
    if (route.screen !== 'moderation' || !user?.isModerator) return;
    let alive = true; setPageLoading(true); setPageError('');
    api('/api/moderation/reports?limit=20&offset=0').then((data) => { if (alive) { setModerationReports(data.reports || []); setModerationNextOffset(data.nextOffset ?? null); } }).catch((e) => alive && setPageError(e.message)).finally(() => alive && setPageLoading(false));
    return () => { alive = false; };
  }, [route.screen, user]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 780px)');
    const update = () => setIsMobile(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    if (!isMobile) return;
    if (mobileNavOpen) {
      mobileNavWasOpen.current = true;
      sidebarRef.current?.querySelector('button.nav-item')?.focus();
    } else if (mobileNavWasOpen.current) {
      mobileNavWasOpen.current = false;
      mobileMenuRef.current?.focus();
    }
  }, [mobileNavOpen, isMobile]);
  useEffect(() => {
    if (!mobileNavOpen || !isMobile) return;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMobileNavOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavOpen, isMobile]);
  useEffect(() => {
    const onPop = () => {
      const match = window.location.pathname.match(/^\/event\/([^/]+)/);
      setRoute(match ? { screen: 'event', slug: decodeURIComponent(match[1]) } : { screen: user ? 'events' : 'landing' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [user]);

  async function handleAuth(form, mode) {
    setBusy(true); setPageError('');
    try {
      const data = await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: form });
      setUser(data.user); setNotice(mode === 'register' ? 'Your account is ready. You can join event communities without completing a profile.' : 'Signed in. Welcome back.');
      const returnSlug = authReturnSlug;
      setAuthReturnSlug('');
      setRouteTo(returnSlug ? { screen: 'event', slug: returnSlug } : { screen: 'events' });
    } finally { setBusy(false); }
  }
  async function logout() {
    const cleared = clearAccountScopedState();
    authGeneration.current += 1;
    setUser(null); setEvents(cleared.events); setMyEvents(cleared.myEvents); setOwnedEvents(cleared.ownedEvents); setCurrentEvent(cleared.currentEvent); setAnnouncements(cleared.announcements); setMatches(cleared.matches); setMatchMessage(cleared.matchMessage); setDiscoverSlug(cleared.discoverSlug); setRequests(cleared.requests); setConnections(cleared.connections); setSelectedConnection(cleared.selectedConnection); setMessages(cleared.messages); setBlocks(cleared.blocks); setCoordinatorEvents(cleared.coordinatorEvents); setModerationReports(cleared.moderationReports); setSelectedReport(cleared.selectedReport); setPendingMatch(cleared.pendingMatch); setReportTarget(cleared.reportTarget); setReportReason(cleared.reportReason); setReportDetails(cleared.reportDetails);
    setEventsNextOffset(null); setMyEventsNextOffset(null); setMatchesNextOffset(null); setRequestsNextOffset(null); setConnectionsNextOffset(null); setMessagesNextOffset(null); setCoordinatorNextOffset(null); setModerationNextOffset(null); setCopiedSlug(''); setEditingEvent(null); setAuthReturnSlug(''); setEventsLoading(false); setMyEventsLoading(false); setPageLoading(false); setChatLoading(false); setBusy(false);
    setRouteTo({ screen: 'landing' });
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setNotice('You’re signed out.');
  }
  async function saveProfile(form) {
    setBusy(true);
    try { const data = await api('/api/profile', { method: 'PUT', body: form }); setUser(data.user); setNotice('Profile saved. Your visibility choices are in effect.'); if (route.screen === 'profile') { if (authReturnSlug) { const slug = authReturnSlug; setAuthReturnSlug(''); setRouteTo({ screen: 'event', slug }); } else setRouteTo({ screen: 'events' }); } }
    finally { setBusy(false); }
  }
  async function openEvent(slug) {
    if (!slug) return;
    setRouteTo({ screen: 'event', slug });
    try { const data = await api(`/api/events/${encodeURIComponent(slug)}`); setCurrentEvent(data.event); }
    catch (error) { setPageError(error.message); }
  }
  async function joinCurrentEvent() {
    if (!user) { setAuthMode('login'); setAuthReturnSlug(currentEvent?.slug || ''); setRouteTo({ screen: 'auth' }); return; }
    if (!currentEvent) return;
    setBusy(true);
    try { await api(`/api/events/${encodeURIComponent(currentEvent.slug)}/join`, { method: 'POST', body: {} }); await refreshAll(); const data = await api(`/api/events/${encodeURIComponent(currentEvent.slug)}`); setCurrentEvent(data.event); const announcementsData = await api(`/api/events/${encodeURIComponent(currentEvent.slug)}/announcements?limit=20&offset=0`); setAnnouncements(announcementsData.announcements || []); setNotice('You joined the event community. Travel matching is still off until you opt in.'); }
    catch (e) { setPageError(e.message); }
    finally { setBusy(false); }
  }
  async function saveTravel(slug, travel) {
    setBusy(true);
    try { await api(`/api/events/${encodeURIComponent(slug)}/travel`, { method: 'PUT', body: travel }); await loadMine(); setNotice('Travel preferences saved. You can change them at any time.'); }
    finally { setBusy(false); }
  }
  async function leaveEvent() {
    if (!currentEvent || !window.confirm('Leave this event community? Pending requests will expire, and accepted chats for this event will close.')) return;
    setBusy(true);
    try { await api(`/api/events/${encodeURIComponent(currentEvent.slug)}/membership`, { method: 'DELETE' }); await refreshAll(); setCurrentEvent({ ...currentEvent, isMember: false }); setNotice('You left the event community.'); }
    catch (e) { setPageError(e.message); }
    finally { setBusy(false); }
  }
  async function sendRequest() {
    if (!pendingMatch) return;
    setBusy(true);
    try { await api('/api/requests', { method: 'POST', body: { userRef: pendingMatch.userRef, consentConfirmed: true } }); setPendingMatch(null); setNotice(consentPolicy.sentNotice); setDiscoverSlug(pendingMatch.eventSlug || discoverSlug); const refreshed = await api(`/api/events/${encodeURIComponent(discoverSlug)}/matches?limit=25&offset=0`); setMatches(refreshed.matches || []); setMatchesNextOffset(refreshed.nextOffset ?? null); setMatchMessage(refreshed.message || ''); }
    catch (e) { setPageError(e.message); setPendingMatch(null); }
    finally { setBusy(false); }
  }
  async function refreshRequests() { return loadRequests(); }
  async function respondRequest(item, action) {
    setBusy(true); setPageError('');
    try {
      await api(`/api/requests/${item.id}/respond`, { method: 'POST', body: { action } });
      setNotice(action === 'accept' ? 'Connection accepted. Approved profile details and private chat are now available.' : 'Request declined. Both identities remain hidden.');
      await refreshRequests();
      if (action === 'accept') { await loadConnections(); navigate('connections'); setSelectedConnection(item.id); }
    } catch (e) { setPageError(e.message); }
    finally { setBusy(false); }
  }
  async function cancelRequest(item) {
    setBusy(true); try { await api(`/api/requests/${item.id}/cancel`, { method: 'POST', body: {} }); await refreshRequests(); setNotice('Request cancelled. Both identities remain hidden.'); } catch (e) { setPageError(e.message); } finally { setBusy(false); }
  }
  async function openChat(connection) {
    setSelectedConnection(connection.id); setMessages([]); setChatLoading(true);
    try { await loadMessages(connection.id); }
    catch (e) { setPageError(e.message); }
    finally { setChatLoading(false); }
  }
  async function sendChatMessage(connectionId, body) {
    const data = await api(`/api/connections/${connectionId}/messages`, { method: 'POST', body: { body } });
    setMessages((current) => [...current, data.message]);
  }
  async function blockUser(target) {
    if (!target?.counterpartRef && !target?.userRef) { setPageError('This attendee can no longer be blocked from this screen.'); return; }
    if (!window.confirm('Block this attendee? They will be removed from recommendations and cannot continue requests or chat.')) return;
    setBusy(true);
    try { await api('/api/blocks', { method: 'POST', body: { userRef: target.counterpartRef || target.userRef } }); setNotice('Attendee blocked. Their identity remains hidden if the request was not accepted.'); await refreshRequests(); if (route.screen === 'connections') { await loadConnections(); setSelectedConnection(''); } if (route.screen === 'discovery') { const data = await api(`/api/events/${encodeURIComponent(discoverSlug)}/matches?limit=25&offset=0`); setMatches(data.matches || []); setMatchesNextOffset(data.nextOffset ?? null); } }
    catch (e) { setPageError(e.message); }
    finally { setBusy(false); }
  }
  async function submitReport() {
    if (!reportTarget) return;
    const userRef = reportTarget.counterpartRef || reportTarget.userRef;
    if (!userRef) return setPageError('This attendee can no longer be reported from this screen.');
    setBusy(true);
    try { await api('/api/reports', { method: 'POST', headers: { 'Idempotency-Key': window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` }, body: { userRef, reason: reportReason, details: reportDetails, ...(reportTarget.id && connections.some((c) => c.id === reportTarget.id) ? { requestId: reportTarget.id } : {}) } }); setReportTarget(null); setReportDetails(''); setNotice('Report submitted privately for moderator review. The reported attendee cannot view it.'); }
    catch (e) { setPageError(e.message); }
    finally { setBusy(false); }
  }
  async function disconnect(connection) {
    if (!window.confirm(`Disconnect from ${connection.profile.name}? Private chat will close.`)) return;
    try { await api(`/api/connections/${connection.id}/disconnect`, { method: 'POST', body: {} }); await loadConnections(); setSelectedConnection(''); setNotice('Connection closed.'); }
    catch (e) { setPageError(e.message); }
  }
  async function unblock(blockId) {
    try { await api(`/api/blocks/${blockId}`, { method: 'DELETE' }); setBlocks((current) => current.filter((item) => item.id !== blockId)); setNotice('Block removed.'); }
    catch (e) { setPageError(e.message); }
  }
  async function createEvent(form) {
    setBusy(true);
    try { const data = await api('/api/events', { method: 'POST', body: form }); await refreshAll(); setCurrentEvent(data.event); setRouteTo({ screen: 'event', slug: data.event.slug }); setNotice('Event created. Share the invitation link from your coordinator dashboard.'); }
    finally { setBusy(false); }
  }
  async function updateEvent(slug, form) {
    setBusy(true);
    try {
      const data = await api(`/api/events/${encodeURIComponent(slug)}`, { method: 'PATCH', body: form });
      await refreshAll(); setCurrentEvent(data.event);
      if (route.screen === 'edit-event') navigate('coordinator');
      setNotice('Event updated.');
      const dashboard = await api('/api/coordinator/dashboard?limit=20&offset=0');
      setCoordinatorEvents(dashboard.events || []); setCoordinatorNextOffset(dashboard.nextOffset ?? null);
    } finally { setBusy(false); }
  }
  async function editEvent(event, action) {
    if (action === 'registration') return toggleRegistration(event);
    setEditingEvent(event); setRouteTo({ screen: 'edit-event' });
  }
  async function toggleRegistration(event) {
    try {
      const data = await api(`/api/events/${encodeURIComponent(event.slug)}`, { method: 'PATCH', body: { registrationOpen: !event.registrationOpen } });
      if (currentEvent?.slug === event.slug) setCurrentEvent(data.event);
      const dashboard = await api('/api/coordinator/dashboard?limit=20&offset=0');
      setCoordinatorEvents(dashboard.events || []); setCoordinatorNextOffset(dashboard.nextOffset ?? null);
      setNotice(data.event.registrationOpen ? 'Registration opened.' : 'Registration closed.');
    } catch (e) { setPageError(e.message); }
  }
  async function cancelEvent(event) {
    if (!window.confirm(`Cancel “${event.name}”? Pending requests will expire and accepted connections and chats for this event will close.`)) return;
    try {
      const data = await api(`/api/events/${encodeURIComponent(event.slug)}`, { method: 'PATCH', body: { status: 'cancelled' } });
      const cleared = clearInactiveEventState({ connections, connectionsNextOffset, selectedConnection, messages, messagesNextOffset, reportTarget, pendingMatch, discoverSlug, matches, matchesNextOffset, matchMessage }, [event.slug]);
      setConnections(cleared.connections); setConnectionsNextOffset(cleared.connectionsNextOffset);
      setSelectedConnection(cleared.selectedConnection); setMessages(cleared.messages); setMessagesNextOffset(cleared.messagesNextOffset);
      setReportTarget(cleared.reportTarget); setPendingMatch(cleared.pendingMatch);
      setDiscoverSlug(cleared.discoverSlug); setMatches(cleared.matches); setMatchesNextOffset(cleared.matchesNextOffset); setMatchMessage(cleared.matchMessage);
      setChatLoading(false);
      const markCancelled = (items) => items.map((item) => item.slug === event.slug ? { ...item, status: 'cancelled', registrationOpen: false } : item);
      setEvents(markCancelled); setMyEvents(markCancelled); setOwnedEvents(markCancelled);
      if (currentEvent?.slug === event.slug) setCurrentEvent(data.event);
      await loadMine();
      await loadConnections();
      const dashboard = await api('/api/coordinator/dashboard?limit=20&offset=0');
      setCoordinatorEvents(dashboard.events || []); setNotice('Event cancelled. Pending requests and accepted access were revoked.');
    } catch (e) { setPageError(e.message); }
  }
  async function publishAnnouncement(slug, body) {
    setBusy(true);
    try { await api(`/api/events/${encodeURIComponent(slug)}/announcements`, { method: 'POST', body: { body } }); const data = await api(`/api/events/${encodeURIComponent(slug)}/announcements`); setAnnouncements(data.announcements || []); setNotice('Announcement published.'); }
    finally { setBusy(false); }
  }
  async function openReport(reportId) {
    try { const data = await api(`/api/moderation/reports/${encodeURIComponent(reportId)}`); setSelectedReport(data.report); }
    catch (e) { setPageError(e.message); }
  }
  async function updateReportStatus(reportId, status) {
    try {
      await api(`/api/moderation/reports/${encodeURIComponent(reportId)}`, { method: 'PATCH', body: { status } });
      setSelectedReport((current) => current?.id === reportId ? { ...current, status } : current);
      const data = await api('/api/moderation/reports?limit=20&offset=0');
      setModerationReports(data.reports || []); setModerationNextOffset(data.nextOffset ?? null);
      setNotice(`Report marked ${status}.`);
    } catch (e) { setPageError(e.message); }
  }
  async function copyInvite(slug) {
    const link = `${window.location.origin}/event/${slug}`;
    try { await navigator.clipboard.writeText(link); setCopiedSlug(slug); setTimeout(() => setCopiedSlug(''), 1800); }
    catch { setPageError(`Copy this invitation link: ${link}`); }
  }
  async function savePrivacy(visibility) {
    return saveProfile({ name: user.name, gender: user.gender, city: user.city, locality: user.locality || '', bio: user.bio || '', interests: user.interests || [], profession: user.profession || '', languages: user.languages || [], matchGenders: user.matchGenders || [], visibility });
  }
  async function showCreateOrDashboard(destination) {
    if (destination === 'dashboard') { navigate('coordinator'); return; }
    setRouteTo({ screen: 'create-event' });
  }

  const onEventJoin = () => joinCurrentEvent();
  const isPublic = route.screen === 'landing' || route.screen === 'auth' || route.screen === 'event';
  const navItems = [
    ['events', 'My events', CalendarDays], ['discovery', 'Find a companion', MapPin], ['requests', 'Requests', Mail], ['connections', 'Connections', MessageCircle], ['profile', 'Profile & privacy', ShieldCheck],
    ...(user?.role === 'coordinator' ? [['coordinator', 'Coordinator desk', Users]] : []),
    ...(user?.isModerator ? [['moderation', 'Report review', ShieldCheck]] : []),
  ];

  if (!authReady) return <div className="app-loading"><Spinner label="Starting Meetups" /></div>;
  const showLanding = route.screen === 'landing' && !user;
  const showHeader = true;

  return <div className="app-root">
    {showHeader && <header className="topbar"><button className="brand-mark" onClick={() => setRouteTo({ screen: user ? 'events' : 'landing' })} aria-label="Meetups home"><span className="brand-symbol"><span /><span /><span /></span><span>meetups</span></button>
      {user ? <><button ref={mobileMenuRef} className="mobile-menu icon-button" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-expanded={mobileNavOpen} aria-controls="main-sidebar" aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}><Menu size={20} /></button><div className="topbar-right"><span className="user-chip"><span className="user-initial">{user.name.slice(0, 1).toUpperCase()}</span>{user.name}</span><button className="icon-button" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button></div></>
      : <div className="topbar-right"><button className="text-button topbar-link" onClick={() => document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })}>Explore events</button><button className="text-button topbar-link" onClick={() => { setAuthMode('login'); navigate('auth'); }}>Sign in</button><Button onClick={() => { setAuthMode('register'); navigate('auth'); }}>Get started <ArrowRight size={15} /></Button></div>}
    </header>}
    {user && <div className={`app-frame ${mobileNavOpen ? 'nav-open' : ''}`}>
      <aside ref={sidebarRef} id="main-sidebar" className="sidebar" aria-label="Main navigation" aria-hidden={isMobile && !mobileNavOpen} inert={isMobile && !mobileNavOpen}><div className="sidebar-label">WORKSPACE</div>{navItems.map(([key, label, Icon]) => <button key={key} className={`nav-item ${route.screen === key ? 'nav-active' : ''}`} onClick={() => navigate(key)}><Icon size={17} /><span>{label}</span>{key === 'requests' && requests.pendingIncomingCount > 0 && <span className="nav-count" aria-label={`${requests.pendingIncomingCount} incoming requests`}>{requests.pendingIncomingCount}</span>}</button>)}<div className="sidebar-bottom"><div className="sidebar-safety"><LockKeyhole size={15} /><span>Your profile stays private until a request is accepted.</span></div><button className="nav-item signout-link" onClick={logout}><LogOut size={16} /><span>Sign out</span></button></div></aside>
      <main className="main-content">
        {notice && <div className="global-notice"><Notice onClose={() => setNotice('')}>{notice}</Notice></div>}
        {pageError && <div className="global-notice"><Notice kind="error" onClose={() => setPageError('')}>{pageError}</Notice></div>}
        {route.screen === 'events' && <EventsPage events={myEvents} ownedEvents={ownedEvents} loading={myEventsLoading} hasError={Boolean(pageError)} nextOffset={myEventsNextOffset} onLoadMore={() => myEventsNextOffset != null && loadMine(myEventsNextOffset, true)} user={user} onOpen={openEvent} onBrowse={() => navigate('browse')} onCreate={showCreateOrDashboard} />}
        {route.screen === 'browse' && <BrowseEventsPage events={events} loading={eventsLoading} hasError={Boolean(pageError)} nextOffset={eventsNextOffset} onLoadMore={() => eventsNextOffset != null && loadEvents(eventsNextOffset, true)} onOpen={openEvent} />}
        {route.screen === 'profile' && <ProfilePage user={user} onSave={saveProfile} onPrivacy={() => navigate('privacy')} loading={busy} />}
        {route.screen === 'discovery' && <DiscoveryPage events={myEvents} slug={discoverSlug} setSlug={(value) => { setDiscoverSlug(value); setMatches([]); }} matches={matches} loading={pageLoading} error={pageError} hasError={Boolean(pageError)} nextOffset={matchesNextOffset} onLoadMore={async () => { if (matchesNextOffset == null) return; const data = await api(`/api/events/${encodeURIComponent(discoverSlug)}/matches?limit=25&offset=${matchesNextOffset}`); setMatches((current) => [...current, ...(data.matches || [])]); setMatchesNextOffset(data.nextOffset ?? null); setMatchMessage(data.message || ''); }} message={matchMessage} onSend={(match) => setPendingMatch({ ...match, eventSlug: discoverSlug })} onBlock={blockUser} onReport={(target) => setReportTarget({ ...target, eventSlug: discoverSlug })} onOpenEvent={openEvent} />}
        {route.screen === 'requests' && <RequestsPage requests={requests} loading={pageLoading} hasError={Boolean(pageError)} nextOffset={requestsNextOffset} onLoadMore={() => requestsNextOffset != null && loadRequests(requestsNextOffset, true)} message={notice} onAccept={(item) => respondRequest(item, 'accept')} onDecline={(item) => respondRequest(item, 'decline')} onCancel={cancelRequest} onBlock={blockUser} onReport={(target) => setReportTarget(target)} />}
        {route.screen === 'connections' && <ConnectionsPage connections={connections} selected={selectedConnection} setSelected={setSelectedConnection} messages={messages} onOpenChat={openChat} onSendMessage={sendChatMessage} onBlock={blockUser} onReport={(target) => setReportTarget(target)} onDisconnect={disconnect} loading={pageLoading} hasError={Boolean(pageError)} nextOffset={connectionsNextOffset} onLoadMore={() => connectionsNextOffset != null && loadConnections(connectionsNextOffset, true)} messagesNextOffset={messagesNextOffset} onLoadEarlier={() => messagesNextOffset != null && selectedConnection && loadMessages(selectedConnection, messagesNextOffset, true)} chatLoading={chatLoading} message={notice} />}
        {route.screen === 'privacy' && <PrivacyPage user={user} onSave={savePrivacy} blocks={blocks} onUnblock={unblock} />}
        {route.screen === 'coordinator' && user.role === 'coordinator' && <CoordinatorPage dashboard={coordinatorEvents} loading={pageLoading} nextOffset={coordinatorNextOffset} onLoadMore={async () => { const data = await api(`/api/coordinator/dashboard?limit=20&offset=${coordinatorNextOffset}`); setCoordinatorEvents((current) => [...current, ...(data.events || [])]); setCoordinatorNextOffset(data.nextOffset ?? null); }} onCreate={() => setRouteTo({ screen: 'create-event' })} onOpenEvent={openEvent} onCopyLink={copyInvite} copyLabel={copiedSlug} onEditEvent={editEvent} onToggleRegistration={toggleRegistration} onCancelEvent={cancelEvent} />}
        {route.screen === 'moderation' && user.isModerator && <ModerationPage reports={moderationReports} selectedReport={selectedReport} onOpen={openReport} onStatusChange={updateReportStatus} loading={pageLoading} nextOffset={moderationNextOffset} onLoadMore={async () => { const data = await api(`/api/moderation/reports?limit=20&offset=${moderationNextOffset}`); setModerationReports((current) => [...current, ...(data.reports || [])]); setModerationNextOffset(data.nextOffset ?? null); }} />}
        {route.screen === 'create-event' && <CreateEventPage user={user} onCreate={createEvent} loading={busy} onBack={() => navigate('coordinator')} />}
        {route.screen === 'edit-event' && <CreateEventPage user={user} event={editingEvent} onCreate={createEvent} onUpdate={updateEvent} loading={busy} onBack={() => navigate('coordinator')} />}
        {route.screen === 'event' && (pageLoading && !currentEvent ? <Spinner label="Loading event" /> : pageError && !currentEvent ? <EmptyState title="Could not load event" body="The invitation could not be loaded. Check the link or return to your events." action={<Button variant="outline" onClick={() => navigate('events')}>Back to events</Button>} /> : <EventPage event={currentEvent} user={user} joined={Boolean(currentEvent?.isMember)} travel={currentTravel} announcements={announcements} onJoin={onEventJoin} onEditTravel={saveTravel} onMatches={() => { setDiscoverSlug(currentEvent.slug); navigate('discovery'); }} onLeave={leaveEvent} onBack={() => navigate('events')} onAnnounce={publishAnnouncement} isCoordinator={Boolean(currentEvent?.isOwner)} onEditEvent={editEvent} onCancelEvent={cancelEvent} loading={busy} />)}
      </main>
    </div>}
    {!user && <main className="public-content">
      {showLanding && <Landing events={publicLandingEvents(events)} loading={eventsLoading} onOpenEvent={openEvent} onJoin={() => document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })} onCoordinator={() => { setAuthMode('login'); navigate('auth'); }} />}
      {route.screen === 'auth' && <AuthPage mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} loading={busy} onBack={() => setRouteTo({ screen: 'landing' })} />}
      {route.screen === 'event' && (pageLoading && !currentEvent ? <Spinner label="Loading event" /> : pageError && !currentEvent ? <EmptyState title="Could not load event" body="The invitation could not be loaded. Check the link or return to the public events page." action={<Button variant="outline" onClick={() => setRouteTo({ screen: 'landing' })}>Back to events</Button>} /> : <EventPage event={currentEvent} user={null} joined={false} onJoin={onEventJoin} onBack={() => setRouteTo({ screen: 'landing' })} announcements={announcements} onEditTravel={saveTravel} onMatches={() => {}} onLeave={() => {}} onAnnounce={publishAnnouncement} isCoordinator={false} loading={busy} />)}
      {!['landing', 'auth', 'event'].includes(route.screen) && <AuthPage mode={authMode} setMode={setAuthMode} onSubmit={handleAuth} loading={busy} onBack={() => setRouteTo({ screen: 'landing' })} />}
    </main>}
    <footer className="app-footer"><span>Meetups · A connection platform, not a transport service.</span><span>{user ? 'Privacy settings are available in your profile.' : 'Privacy settings are available after sign-in.'}</span></footer>
    {pendingMatch && <Modal title={consentPolicy.senderTitle} onClose={() => setPendingMatch(null)} footer={<><Button variant="outline" onClick={() => setPendingMatch(null)}>Not now</Button><Button onClick={sendRequest} disabled={busy}>{busy ? 'Sending…' : 'Send request'} <ArrowRight size={15} /></Button></>}><div className="consent-status-label">{consentPolicy.statusLabel}</div><div className="consent-modal-icon"><LockKeyhole size={20} /></div><p className="consent-copy">{consentPolicy.senderDisclosure}</p><p className="muted small">{consentPolicy.senderOutcome}</p></Modal>}
    {reportTarget && <Modal title="Report an attendee" onClose={() => setReportTarget(null)} footer={<><Button variant="outline" onClick={() => setReportTarget(null)}>Cancel</Button><Button onClick={submitReport} disabled={busy}>{busy ? 'Sending…' : 'Submit report'}</Button></>}><p className="muted">Reports are private and are not visible to the attendee you report.</p><Field label="Reason"><select value={reportReason} onChange={(e) => setReportReason(e.target.value)}><option value="safety">Safety concern</option><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="misrepresentation">Misrepresentation</option><option value="other">Other</option></select></Field><Field label="Details (optional)"><textarea rows="4" maxLength="1000" value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} placeholder="What should the moderation team know?" /></Field></Modal>}
  </div>;
}
