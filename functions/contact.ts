/// <reference types="@cloudflare/workers-types" />

interface ContactRequest {
  name: string;
  email: string;
  phone: string;
  message: string;
}

interface Env {
  RESEND_API_KEY: string;
  TO_EMAIL: string;
  ALLOWED_ORIGINS: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    
    // CORS check
    const origin = request.headers.get('Origin');
    const allowedDomains = env.ALLOWED_ORIGINS.split(',');
    
    if (origin && !allowedDomains.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    const contentType = request.headers.get('content-type');
    let contactData: ContactRequest;

    if (contentType?.includes('application/json')) {
      contactData = await request.json() as ContactRequest;
    } else {
      const formData = await request.formData();
      contactData = {
        name: (formData.get('name') as string) || '',
        email: (formData.get('email') as string) || '',
        phone: (formData.get('phone') as string) || '',
        message: (formData.get('message') as string) || '',
      };
    }

    // Sanitize inputs
    const sanitize = (str: string) => str.replace(/<[^>]*>/g, '').trim();
    contactData.name = sanitize(contactData.name);
    contactData.email = sanitize(contactData.email);
    contactData.phone = sanitize(contactData.phone);
    contactData.message = sanitize(contactData.message);

    // Validate required fields
    if (!contactData.name || !contactData.email || !contactData.message) {
      return new Response('Missing required fields: name, email, message', { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactData.email)) {
      return new Response('Invalid email format', { status: 400 });
    }

    // Content length limits
    if (contactData.name.length > 100 || contactData.email.length > 255 || contactData.message.length > 5000) {
      return new Response('Input too long', { status: 400 });
    }

    // Gather connection metadata
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const userAgent = request.headers.get('User-Agent') || 'unknown';
    const country = request.cf?.country || 'unknown';
    const city = request.cf?.city || 'unknown';
    const region = request.cf?.region || 'unknown';
    const timezone = request.cf?.timezone || 'unknown';
    const asn = request.cf?.asn || 'unknown';
    const colo = request.cf?.colo || 'unknown';

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'contact@yourdomain.com',
        to: env.TO_EMAIL,
        subject: `Contact Form: ${contactData.name}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${contactData.name}</p>
          <p><strong>Email:</strong> ${contactData.email}</p>
          <p><strong>Phone:</strong> ${contactData.phone || 'Not provided'}</p>
          <p><strong>Message:</strong></p>
          <p>${contactData.message.replace(/\n/g, '<br>')}</p>
          
          <hr>
          <h3>Connection Details</h3>
          <p><strong>IP Address:</strong> ${clientIP}</p>
          <p><strong>Location:</strong> ${city}, ${region}, ${country}</p>
          <p><strong>Timezone:</strong> ${timezone}</p>
          <p><strong>ISP:</strong> ${asn}</p>
          <p><strong>Cloudflare DC:</strong> ${colo}</p>
          <p><strong>User Agent:</strong> ${userAgent}</p>
        `,
        reply_to: contactData.email,
      }),
    });

    if (!emailResponse.ok) {
      throw new Error('Failed to send email');
    }

    return new Response(JSON.stringify({ success: true, message: 'Email sent successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Contact form error:', error);
    return new Response(JSON.stringify({ success: false, message: 'Failed to send email' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};