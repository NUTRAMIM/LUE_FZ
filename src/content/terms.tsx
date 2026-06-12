// src/content/terms.tsx
// Documento de Termos de Uso + Politica de Privacidade (LGPD). Acoplado a
// TERMS_VERSION em src/lib/terms.ts: ao alterar o texto de forma material,
// faca o bump da versao para re-disparar o aceite.

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-7 first:mt-0">
      <h2 className="font-display text-[16px] font-bold text-ink-900">{title}</h2>
      <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-ink-700">
        {children}
      </div>
    </section>
  )
}

export function TermsDocument() {
  return (
    <article className="prose-none">
      <p className="text-[12.5px] text-ink-500">
        Versão de 11 de junho de 2026. Última atualização: 11/06/2026.
      </p>

      <Section id="t1" title="1. Identificação das partes">
        <p>
          Estes Termos de Uso e a Política de Privacidade regem o uso da
          plataforma LUE FZ (&quot;Plataforma&quot;, &quot;LUE&quot;,
          &quot;nós&quot;). &quot;Usuário&quot; ou
          &quot;Lojista&quot; é a pessoa física ou jurídica que cria uma conta e
          contrata a Plataforma. &quot;Cliente final&quot; é o consumidor que
          interage com o atendimento da loja do Usuário.
        </p>
      </Section>

      <Section id="t2" title="2. Descrição do serviço">
        <p>
          A Plataforma oferece atendimento ao cliente por meio de um agente de
          inteligência artificial em um chat público, painel de operador com
          possibilidade de intervenção humana (takeover), gestão de estoque,
          captação e gestão de leads e gestão de equipe. Os recursos disponíveis
          dependem do plano contratado.
        </p>
      </Section>

      <Section id="t3" title="3. Conta, acesso e elegibilidade">
        <p>
          O Usuário declara ter pelo menos 18 anos e capacidade civil para
          contratar. É responsável pela veracidade dos dados cadastrais, pela
          guarda de suas credenciais e por toda atividade realizada em sua conta,
          inclusive por vendedores que convidar para a equipe.
        </p>
      </Section>

      <Section id="t4" title="4. Assinatura, planos e pagamento">
        <p>
          O acesso é prestado mediante assinatura recorrente, conforme o plano
          escolhido. Os pagamentos são processados por terceiros (Stripe e
          Mercado Pago, inclusive via PIX). A assinatura é renovada
          automaticamente até cancelamento pelo Usuário. O cancelamento
          interrompe renovações futuras; condições de reembolso seguem a
          legislação aplicável. A inadimplência pode resultar na suspensão do
          acesso.
        </p>
      </Section>

      <Section id="t5" title="5. Uso da inteligência artificial">
        <p>
          As respostas do agente de IA são geradas automaticamente e podem
          conter erros, imprecisões ou informações desatualizadas. O Usuário é
          responsável por supervisionar o atendimento e pode assumir a conversa a
          qualquer momento (takeover). A IA não garante vendas nem substitui
          aconselhamento profissional, jurídico, médico ou financeiro.
        </p>
      </Section>

      <Section id="t6" title="6. Conteúdo do Usuário e estoque">
        <p>
          O Usuário é o único responsável pela veracidade e legalidade das
          informações que cadastra ou importa, incluindo produtos, preços,
          disponibilidade e condições de venda. A LUE não verifica e não se
          responsabiliza por esse conteúdo.
        </p>
      </Section>

      <Section id="t7" title="7. Proteção de dados pessoais (LGPD)">
        <p>
          No tratamento dos dados pessoais dos Clientes finais coletados pela
          Plataforma (como nome, telefone/WhatsApp, e-mail e histórico de
          conversas), o Usuário atua como <strong>Controlador</strong> e a LUE
          como <strong>Operadora</strong>, nos termos da Lei nº 13.709/2018
          (LGPD). Cabe ao Usuário definir as bases legais e obter os
          consentimentos necessários junto aos seus Clientes finais. A LUE adota
          medidas de segurança razoáveis e trata os dados conforme as instruções
          do Usuário e esta Política. Solicitações de titulares e comunicação de
          incidentes podem ser direcionadas pelos canais de atendimento da
          Plataforma.
        </p>
      </Section>

      <Section id="t8" title="8. Uso aceitável">
        <p>
          É vedado usar a Plataforma para fins ilícitos, comercializar produtos
          proibidos por lei, enviar spam, violar direitos de terceiros, realizar
          engenharia reversa, sobrecarregar ou tentar burlar mecanismos de
          segurança e cobrança.
        </p>
      </Section>

      <Section id="t9" title="9. Propriedade intelectual">
        <p>
          A Plataforma, seu código, marca e demais elementos são de titularidade
          da LUE. O Usuário mantém a titularidade de seus dados, marca e
          conteúdo, concedendo à LUE licença limitada para operá-los na prestação
          do serviço.
        </p>
      </Section>

      <Section id="t10" title="10. Disponibilidade e terceiros">
        <p>
          A LUE empenha-se em manter a Plataforma disponível, mas não garante
          funcionamento ininterrupto ou livre de erros. O serviço depende de
          fornecedores terceiros (como provedores de hospedagem, banco de dados e
          de modelos de IA), cujas indisponibilidades podem afetar a operação.
        </p>
      </Section>

      <Section id="t11" title="11. Limitação de responsabilidade">
        <p>
          Na máxima extensão permitida pela lei, a LUE não responde por danos
          indiretos, lucros cessantes ou perda de dados decorrentes do uso ou da
          impossibilidade de uso da Plataforma. A responsabilidade total da LUE
          fica limitada aos valores pagos pelo Usuário nos 12 meses anteriores ao
          evento que originou a reclamação.
        </p>
      </Section>

      <Section id="t12" title="12. Suspensão e encerramento">
        <p>
          A LUE pode suspender ou encerrar contas que violem estes Termos. O
          Usuário pode encerrar a conta a qualquer momento. Após o encerramento,
          os dados podem ser excluídos conforme os prazos legais e de retenção
          aplicáveis.
        </p>
      </Section>

      <Section id="t13" title="13. Alterações destes Termos">
        <p>
          Estes Termos podem ser atualizados. Alterações materiais serão
          comunicadas e, quando aplicável, exigirão novo aceite para continuar
          usando a Plataforma.
        </p>
      </Section>

      <Section id="t14" title="14. Lei aplicável e foro">
        <p>
          Estes Termos são regidos pelas leis brasileiras. Fica eleito o foro do
          domicílio do Usuário para dirimir quaisquer controvérsias decorrentes
          destes Termos.
        </p>
      </Section>

      <Section id="t15" title="15. Registro do aceite">
        <p>
          Ao marcar a caixa de concordância e prosseguir, o Usuário declara que
          leu e concorda com estes Termos. O aceite é registrado com a versão do
          documento, data, hora e endereço IP, servindo como prova do
          consentimento.
        </p>
      </Section>
    </article>
  )
}
